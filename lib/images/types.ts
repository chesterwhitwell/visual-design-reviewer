export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedImageMimeType =
  (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export interface ImageProcessingLimits {
  /** Maximum compressed upload size for one image. */
  maxInputBytes: number;
  /** Maximum decoded pixel count for one image. */
  maxPixels: number;
  maxWidth: number;
  maxHeight: number;
  /** Maximum size of the metadata-free analysis copy. */
  maxSanitizedBytes: number;
  previewMaxWidth: number;
  previewMaxHeight: number;
  maxPreviewBytes: number;
}

export interface ImageBatchLimits {
  maxImages: number;
  maxTotalBytes: number;
}

export interface ImageUploadInput {
  bytes: Uint8Array;
  /** Optional transport MIME type. Actual type is always detected from bytes. */
  declaredMimeType?: string | null;
}

export interface ProcessedImageVariant {
  bytes: Buffer;
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
}

export interface ProcessedImage extends ProcessedImageVariant {
  preview: ProcessedImageVariant;
}

export interface ImageProcessor {
  process(input: ImageUploadInput): Promise<ProcessedImage>;
}

export type StoredImageKind = "analysis" | "preview";

/**
 * Persistable metadata for one encrypted blob. Nonces and authentication tags
 * remain inside the ciphertext envelope rather than in application records.
 */
export interface EncryptedImageBlobRecord {
  version: 1;
  locator: string;
  kind: StoredImageKind;
  plaintextBytes: number;
  ciphertextBytes: number;
  sha256: string;
}

/** Independent of any database model; callers may embed this in their records. */
export interface EncryptedImageAssetRecord {
  version: 1;
  assetId: string;
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  sha256: string;
  previewMimeType: SupportedImageMimeType;
  previewWidth: number;
  previewHeight: number;
  analysis: EncryptedImageBlobRecord;
  preview: EncryptedImageBlobRecord;
}

export interface ImagePurgeResult {
  analysis: "purged" | "already_missing";
  preview: "purged" | "already_missing";
}

export interface ImageStore {
  put(image: ProcessedImage): Promise<EncryptedImageAssetRecord>;
  readAnalysis(record: EncryptedImageAssetRecord): Promise<Buffer>;
  readPreview(record: EncryptedImageAssetRecord): Promise<Buffer>;
  purge(record: EncryptedImageAssetRecord): Promise<ImagePurgeResult>;
}

