import {
  constants,
  type PathLike,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { isAbsolute, join, parse, resolve } from "node:path";

import { ImagePipelineError } from "./errors";
import type {
  EncryptedImageAssetRecord,
  EncryptedImageBlobRecord,
  ImagePurgeResult,
  ImageStore,
  ProcessedImage,
  ProcessedImageVariant,
  StoredImageKind,
  SupportedImageMimeType,
} from "./types";

const ENVELOPE_MAGIC = Buffer.from("VDRI", "ascii");
const ENVELOPE_VERSION = 1;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENVELOPE_HEADER_BYTES =
  ENVELOPE_MAGIC.byteLength + 1 + NONCE_BYTES + AUTH_TAG_BYTES;
const LOCATOR_PATTERN = /^[a-f0-9]{32}\.vdr$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface LocalEncryptedImageStoreOptions {
  /** A dedicated directory outside the web root. */
  directory: string;
  /** Server-provided AES-256 key bytes. */
  key: Uint8Array;
  /** Hard bound applied before either encryption or decryption. */
  maxPlaintextBytes: number;
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMimeType(value: unknown): value is SupportedImageMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function assertPositiveSafeInteger(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new ImagePipelineError("invalid_storage_record");
  }
}

function assertBlobRecord(
  record: EncryptedImageBlobRecord,
  expectedKind: StoredImageKind,
  maxPlaintextBytes: number,
): void {
  if (
    record == null ||
    typeof record !== "object" ||
    record.version !== 1 ||
    record.kind !== expectedKind ||
    typeof record.locator !== "string" ||
    !LOCATOR_PATTERN.test(record.locator) ||
    typeof record.sha256 !== "string" ||
    !SHA256_PATTERN.test(record.sha256)
  ) {
    throw new ImagePipelineError("invalid_storage_record");
  }

  assertPositiveSafeInteger(record.plaintextBytes);
  assertPositiveSafeInteger(record.ciphertextBytes);
  if (
    record.plaintextBytes > maxPlaintextBytes ||
    record.ciphertextBytes !== record.plaintextBytes + ENVELOPE_HEADER_BYTES
  ) {
    throw new ImagePipelineError("invalid_storage_record");
  }
}

function assertAssetRecord(
  record: EncryptedImageAssetRecord,
  maxPlaintextBytes: number,
): void {
  if (
    record == null ||
    typeof record !== "object" ||
    record.version !== 1 ||
    typeof record.assetId !== "string" ||
    record.assetId.length === 0 ||
    !isMimeType(record.mimeType) ||
    !isMimeType(record.previewMimeType) ||
    typeof record.sha256 !== "string" ||
    !SHA256_PATTERN.test(record.sha256)
  ) {
    throw new ImagePipelineError("invalid_storage_record");
  }

  assertPositiveSafeInteger(record.width);
  assertPositiveSafeInteger(record.height);
  assertPositiveSafeInteger(record.previewWidth);
  assertPositiveSafeInteger(record.previewHeight);
  assertBlobRecord(record.analysis, "analysis", maxPlaintextBytes);
  assertBlobRecord(record.preview, "preview", maxPlaintextBytes);

  if (
    record.analysis.locator === record.preview.locator ||
    record.analysis.sha256 !== record.sha256
  ) {
    throw new ImagePipelineError("invalid_storage_record");
  }
}

function assertProcessedVariant(variant: ProcessedImageVariant): void {
  if (
    variant == null ||
    typeof variant !== "object" ||
    !Buffer.isBuffer(variant.bytes) ||
    !isMimeType(variant.mimeType) ||
    variant.byteLength !== variant.bytes.byteLength ||
    variant.sha256 !== digest(variant.bytes)
  ) {
    throw new ImagePipelineError("invalid_storage_record");
  }
  assertPositiveSafeInteger(variant.width);
  assertPositiveSafeInteger(variant.height);
}

function additionalAuthenticatedData(record: EncryptedImageBlobRecord): Buffer {
  return Buffer.from(
    [
      "visual-design-reviewer:image:v1",
      record.locator,
      record.kind,
      String(record.plaintextBytes),
      String(record.ciphertextBytes),
      record.sha256,
    ].join("\n"),
    "utf8",
  );
}

function decodeBase64Key(value: string): Buffer | null {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(standard)) {
    return null;
  }
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  try {
    return Buffer.from(padded, "base64");
  } catch {
    return null;
  }
}

/** Parse a server secret in `hex:...`, `base64:...`, or unprefixed Base64 form. */
export function parseImageEncryptionKey(value: string | undefined): Buffer {
  if (value == null) {
    throw new ImagePipelineError("invalid_encryption_key");
  }

  let key: Buffer | null;
  if (value.startsWith("hex:")) {
    const encoded = value.slice(4);
    key = /^[a-fA-F0-9]{64}$/.test(encoded)
      ? Buffer.from(encoded, "hex")
      : null;
  } else {
    const encoded = value.startsWith("base64:") ? value.slice(7) : value;
    key = decodeBase64Key(encoded);
  }

  if (key == null || key.byteLength !== 32) {
    key?.fill(0);
    throw new ImagePipelineError("invalid_encryption_key");
  }
  return key;
}

/**
 * Filesystem-backed authenticated image storage. Only AES-GCM envelopes are
 * written; uploaded and sanitised plaintext bytes are never written to disk.
 */
export class LocalEncryptedImageStore implements ImageStore {
  readonly directory: string;
  readonly maxPlaintextBytes: number;
  private readonly key: Buffer;

  constructor(options: LocalEncryptedImageStoreOptions) {
    if (options.key.byteLength !== 32) {
      throw new ImagePipelineError("invalid_encryption_key");
    }
    if (
      !Number.isSafeInteger(options.maxPlaintextBytes) ||
      options.maxPlaintextBytes <= 0
    ) {
      throw new ImagePipelineError("invalid_limits");
    }
    if (
      typeof options.directory !== "string" ||
      options.directory.length === 0 ||
      !isAbsolute(options.directory)
    ) {
      throw new ImagePipelineError("storage_unavailable");
    }

    const directory = resolve(options.directory);
    if (directory === parse(directory).root) {
      throw new ImagePipelineError("storage_unavailable");
    }

    this.directory = directory;
    this.maxPlaintextBytes = options.maxPlaintextBytes;
    this.key = Buffer.from(options.key);
  }

  async put(image: ProcessedImage): Promise<EncryptedImageAssetRecord> {
    assertProcessedVariant(image);
    assertProcessedVariant(image.preview);

    const analysis = await this.putBlob(image.bytes, "analysis");
    let preview: EncryptedImageBlobRecord;
    try {
      preview = await this.putBlob(image.preview.bytes, "preview");
    } catch (error) {
      await this.tryPurgeAfterFailedPut(analysis);
      throw error;
    }

    return {
      version: 1,
      assetId: randomUUID(),
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      sha256: analysis.sha256,
      previewMimeType: image.preview.mimeType,
      previewWidth: image.preview.width,
      previewHeight: image.preview.height,
      analysis,
      preview,
    };
  }

  async readAnalysis(record: EncryptedImageAssetRecord): Promise<Buffer> {
    assertAssetRecord(record, this.maxPlaintextBytes);
    return this.readBlob(record.analysis);
  }

  async readPreview(record: EncryptedImageAssetRecord): Promise<Buffer> {
    assertAssetRecord(record, this.maxPlaintextBytes);
    return this.readBlob(record.preview);
  }

  /**
   * Prefer this callback form for short-lived consumers. The decrypted buffer
   * is zeroed as soon as the callback settles.
   */
  async withDecryptedAnalysis<T>(
    record: EncryptedImageAssetRecord,
    consumer: (bytes: Buffer) => T | Promise<T>,
  ): Promise<T> {
    const bytes = await this.readAnalysis(record);
    try {
      return await consumer(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  async withDecryptedPreview<T>(
    record: EncryptedImageAssetRecord,
    consumer: (bytes: Buffer) => T | Promise<T>,
  ): Promise<T> {
    const bytes = await this.readPreview(record);
    try {
      return await consumer(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  async purge(record: EncryptedImageAssetRecord): Promise<ImagePurgeResult> {
    assertAssetRecord(record, this.maxPlaintextBytes);

    const [analysis, preview] = await Promise.allSettled([
      this.purgeBlob(record.analysis),
      this.purgeBlob(record.preview),
    ]);
    if (analysis.status === "rejected" || preview.status === "rejected") {
      throw new ImagePipelineError("purge_failed");
    }

    return { analysis: analysis.value, preview: preview.value };
  }

  private async ensurePrivateDirectory(): Promise<void> {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const info = await lstat(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new ImagePipelineError("storage_unavailable");
      }
      await chmod(this.directory, 0o700);
    } catch (error) {
      if (error instanceof ImagePipelineError) {
        throw error;
      }
      throw new ImagePipelineError("storage_unavailable");
    }
  }

  private filePath(locator: string): string {
    if (!LOCATOR_PATTERN.test(locator)) {
      throw new ImagePipelineError("invalid_storage_record");
    }
    return join(this.directory, locator);
  }

  private async putBlob(
    plaintext: Buffer,
    kind: StoredImageKind,
  ): Promise<EncryptedImageBlobRecord> {
    if (plaintext.byteLength === 0 || plaintext.byteLength > this.maxPlaintextBytes) {
      throw new ImagePipelineError("storage_limit_exceeded");
    }
    await this.ensurePrivateDirectory();

    const locator = `${randomBytes(16).toString("hex")}.vdr`;
    const record: EncryptedImageBlobRecord = {
      version: 1,
      locator,
      kind,
      plaintextBytes: plaintext.byteLength,
      ciphertextBytes: plaintext.byteLength + ENVELOPE_HEADER_BYTES,
      sha256: digest(plaintext),
    };
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(additionalAuthenticatedData(record), {
      plaintextLength: plaintext.byteLength,
    });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const envelope = Buffer.concat([
      ENVELOPE_MAGIC,
      Buffer.from([ENVELOPE_VERSION]),
      nonce,
      authTag,
      ciphertext,
    ]);
    const path = this.filePath(locator);

    try {
      await writeFile(path, envelope, { flag: "wx", mode: 0o600 });
      return record;
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        try {
          await unlink(path);
        } catch {
          // The failed write either created nothing or left ciphertext only.
        }
      }
      throw new ImagePipelineError("storage_unavailable");
    } finally {
      nonce.fill(0);
      authTag.fill(0);
      ciphertext.fill(0);
      envelope.fill(0);
    }
  }

  private async readBlob(record: EncryptedImageBlobRecord): Promise<Buffer> {
    assertBlobRecord(record, record.kind, this.maxPlaintextBytes);
    const path = this.filePath(record.locator);
    let envelope: Buffer;

    try {
      const noFollow = constants.O_NOFOLLOW ?? 0;
      const handle = await open(path as PathLike, constants.O_RDONLY | noFollow);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size !== record.ciphertextBytes) {
          throw new ImagePipelineError("asset_corrupt");
        }
        envelope = await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof ImagePipelineError) {
        throw error;
      }
      if (isErrno(error, "ENOENT")) {
        throw new ImagePipelineError("asset_not_found");
      }
      throw new ImagePipelineError("storage_unavailable");
    }

    let plaintext: Buffer | undefined;
    try {
      if (
        envelope.byteLength !== record.ciphertextBytes ||
        !envelope.subarray(0, ENVELOPE_MAGIC.byteLength).equals(ENVELOPE_MAGIC) ||
        envelope[ENVELOPE_MAGIC.byteLength] !== ENVELOPE_VERSION
      ) {
        throw new ImagePipelineError("asset_corrupt");
      }

      const nonceStart = ENVELOPE_MAGIC.byteLength + 1;
      const tagStart = nonceStart + NONCE_BYTES;
      const ciphertextStart = tagStart + AUTH_TAG_BYTES;
      const nonce = envelope.subarray(nonceStart, tagStart);
      const authTag = envelope.subarray(tagStart, ciphertextStart);
      const ciphertext = envelope.subarray(ciphertextStart);

      let decryptedChunk: Buffer | undefined;
      let finalChunk: Buffer | undefined;
      try {
        const decipher = createDecipheriv("aes-256-gcm", this.key, nonce, {
          authTagLength: AUTH_TAG_BYTES,
        });
        decipher.setAAD(additionalAuthenticatedData(record), {
          plaintextLength: record.plaintextBytes,
        });
        decipher.setAuthTag(authTag);
        decryptedChunk = decipher.update(ciphertext);
        finalChunk = decipher.final();
        plaintext = Buffer.concat([decryptedChunk, finalChunk]);
      } catch {
        decryptedChunk?.fill(0);
        finalChunk?.fill(0);
        plaintext?.fill(0);
        plaintext = undefined;
        throw new ImagePipelineError("asset_corrupt");
      } finally {
        decryptedChunk?.fill(0);
        finalChunk?.fill(0);
      }

      const actualDigest = createHash("sha256").update(plaintext).digest();
      const expectedDigest = Buffer.from(record.sha256, "hex");
      if (
        plaintext.byteLength !== record.plaintextBytes ||
        !timingSafeEqual(actualDigest, expectedDigest)
      ) {
        plaintext.fill(0);
        plaintext = undefined;
        throw new ImagePipelineError("asset_corrupt");
      }
      return plaintext;
    } finally {
      envelope.fill(0);
    }
  }

  private async purgeBlob(
    record: EncryptedImageBlobRecord,
  ): Promise<"purged" | "already_missing"> {
    try {
      await unlink(this.filePath(record.locator));
      return "purged";
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return "already_missing";
      }
      throw new ImagePipelineError("purge_failed");
    }
  }

  private async tryPurgeAfterFailedPut(
    record: EncryptedImageBlobRecord,
  ): Promise<void> {
    try {
      await this.purgeBlob(record);
    } catch {
      // Preserve the original put error. Any orphan contains ciphertext only.
    }
  }
}
