import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  LocalEncryptedImageStore,
  parseImageEncryptionKey,
  SharpImageProcessor,
  type EncryptedImageAssetRecord,
  type ImageProcessingLimits,
} from "@/lib/images";

const LIMITS: ImageProcessingLimits = {
  maxInputBytes: 1024 * 1024,
  maxPixels: 100_000,
  maxWidth: 1_000,
  maxHeight: 1_000,
  maxSanitizedBytes: 1024 * 1024,
  previewMaxWidth: 16,
  previewMaxHeight: 16,
  maxPreviewBytes: 128 * 1024,
};

const temporaryDirectories: string[] = [];

async function makeProcessedImage() {
  const input = await sharp({
    create: {
      width: 10,
      height: 8,
      channels: 3,
      background: { r: 17, g: 42, b: 91 },
    },
  })
    .png()
    .toBuffer();
  return new SharpImageProcessor(LIMITS).process({ bytes: input });
}

async function makeStore(key = randomBytes(32)) {
  const root = await mkdtemp(join(tmpdir(), "vdr-image-store-"));
  temporaryDirectories.push(root);
  const directory = join(root, "private-assets");
  return {
    directory,
    store: new LocalEncryptedImageStore({
      directory,
      key,
      maxPlaintextBytes: 2 * 1024 * 1024,
    }),
  };
}

function expectImageError(code: string) {
  return expect.objectContaining({ code, retryable: false });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("LocalEncryptedImageStore", () => {
  it("stores only encrypted, randomly named analysis and preview blobs", async () => {
    const processed = await makeProcessedImage();
    const { directory, store } = await makeStore();
    const record = await store.put(processed);
    const names = await readdir(directory);

    expect(names).toHaveLength(2);
    expect(names.sort()).toEqual(
      [record.analysis.locator, record.preview.locator].sort(),
    );
    expect(names.every((name) => /^[a-f0-9]{32}\.vdr$/.test(name))).toBe(true);
    expect(JSON.stringify(record)).not.toContain("original");

    const analysisEnvelope = await readFile(join(directory, record.analysis.locator));
    const previewEnvelope = await readFile(join(directory, record.preview.locator));
    expect(analysisEnvelope.equals(processed.bytes)).toBe(false);
    expect(previewEnvelope.equals(processed.preview.bytes)).toBe(false);
    expect(analysisEnvelope.includes(processed.bytes)).toBe(false);
    expect(previewEnvelope.includes(processed.preview.bytes)).toBe(false);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, record.analysis.locator))).mode & 0o777).toBe(
      0o600,
    );
  });

  it("round-trips authenticated ciphertext and can zero short-lived reads", async () => {
    const processed = await makeProcessedImage();
    const { store } = await makeStore();
    const record = await store.put(processed);

    const analysis = await store.readAnalysis(record);
    const preview = await store.readPreview(record);
    expect(analysis).toEqual(processed.bytes);
    expect(preview).toEqual(processed.preview.bytes);
    analysis.fill(0);
    preview.fill(0);

    let borrowed: Buffer | undefined;
    const observedDigest = await store.withDecryptedAnalysis(record, (bytes) => {
      borrowed = bytes;
      return record.sha256;
    });
    expect(observedDigest).toBe(processed.sha256);
    expect(borrowed).toBeDefined();
    expect(borrowed?.every((byte) => byte === 0)).toBe(true);
  });

  it("detects tampering and use of the wrong key", async () => {
    const processed = await makeProcessedImage();
    const key = randomBytes(32);
    const { directory, store } = await makeStore(key);
    const record = await store.put(processed);
    const analysisPath = join(directory, record.analysis.locator);
    const envelope = await readFile(analysisPath);
    envelope[envelope.length - 1] ^= 0xff;
    await writeFile(analysisPath, envelope);

    await expect(store.readAnalysis(record)).rejects.toEqual(
      expectImageError("asset_corrupt"),
    );

    const wrongKeyStore = new LocalEncryptedImageStore({
      directory,
      key: randomBytes(32),
      maxPlaintextBytes: 2 * 1024 * 1024,
    });
    await expect(wrongKeyStore.readPreview(record)).rejects.toEqual(
      expectImageError("asset_corrupt"),
    );
  });

  it("purges both ciphertexts idempotently", async () => {
    const processed = await makeProcessedImage();
    const { directory, store } = await makeStore();
    const record = await store.put(processed);

    await expect(store.purge(record)).resolves.toEqual({
      analysis: "purged",
      preview: "purged",
    });
    await expect(readdir(directory)).resolves.toEqual([]);
    await expect(store.readAnalysis(record)).rejects.toEqual(
      expectImageError("asset_not_found"),
    );
    await expect(store.purge(record)).resolves.toEqual({
      analysis: "already_missing",
      preview: "already_missing",
    });
  });

  it("rejects traversal locators and oversized plaintext", async () => {
    const processed = await makeProcessedImage();
    const { store } = await makeStore();
    const record = await store.put(processed);
    const invalidRecord = {
      ...record,
      analysis: { ...record.analysis, locator: "../../outside" },
    } as EncryptedImageAssetRecord;

    await expect(store.readAnalysis(invalidRecord)).rejects.toEqual(
      expectImageError("invalid_storage_record"),
    );

    const limited = new LocalEncryptedImageStore({
      directory: store.directory,
      key: randomBytes(32),
      maxPlaintextBytes: 1,
    });
    await expect(limited.put(processed)).rejects.toEqual(
      expectImageError("storage_limit_exceeded"),
    );
  });
});

describe("image encryption key parsing", () => {
  it("accepts exact 32-byte hex and Base64 secrets", () => {
    const key = randomBytes(32);
    expect(parseImageEncryptionKey(`hex:${key.toString("hex")}`)).toEqual(key);
    expect(parseImageEncryptionKey(`base64:${key.toString("base64")}`)).toEqual(key);
    expect(parseImageEncryptionKey(key.toString("base64url"))).toEqual(key);
  });

  it("rejects absent or wrong-length secrets with a safe error", () => {
    expect(() => parseImageEncryptionKey(undefined)).toThrowError(
      expectImageError("invalid_encryption_key"),
    );
    expect(() => parseImageEncryptionKey(Buffer.alloc(16).toString("base64"))).toThrowError(
      expectImageError("invalid_encryption_key"),
    );
  });
});

