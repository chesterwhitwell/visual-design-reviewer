export const IMAGE_ERROR_CODES = [
  "input_empty",
  "input_too_large",
  "too_many_images",
  "aggregate_too_large",
  "unsupported_type",
  "type_mismatch",
  "malformed_image",
  "corrupt_image",
  "animated_image",
  "pixel_limit_exceeded",
  "dimension_limit_exceeded",
  "sanitized_too_large",
  "preview_too_large",
  "invalid_limits",
  "invalid_encryption_key",
  "invalid_storage_record",
  "storage_limit_exceeded",
  "asset_not_found",
  "asset_corrupt",
  "storage_unavailable",
  "purge_failed",
] as const;

export type ImageErrorCode = (typeof IMAGE_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<ImageErrorCode, string>> = {
  input_empty: "The uploaded image is empty.",
  input_too_large: "The uploaded image exceeds the configured byte limit.",
  too_many_images: "The upload contains more images than the configured limit.",
  aggregate_too_large: "The combined upload exceeds the configured byte limit.",
  unsupported_type: "Only JPEG, PNG, and WebP images are supported.",
  type_mismatch: "The declared image type does not match the file contents.",
  malformed_image: "The image container is malformed or contains unexpected trailing data.",
  corrupt_image: "The image could not be decoded safely.",
  animated_image: "Animated or multi-page images are not supported.",
  pixel_limit_exceeded: "The image exceeds the configured pixel limit.",
  dimension_limit_exceeded: "The image dimensions exceed the configured limit.",
  sanitized_too_large: "The sanitised image exceeds the configured byte limit.",
  preview_too_large: "The image preview exceeds the configured byte limit.",
  invalid_limits: "The image-processing limits are invalid.",
  invalid_encryption_key: "The image encryption key must contain exactly 32 bytes.",
  invalid_storage_record: "The encrypted image storage record is invalid.",
  storage_limit_exceeded: "The image exceeds the configured encrypted-storage limit.",
  asset_not_found: "The retained image is no longer available.",
  asset_corrupt: "The retained image failed its integrity check.",
  storage_unavailable: "The private image store is unavailable.",
  purge_failed: "The retained image could not be fully purged.",
};

/**
 * An error that is safe to cross an application boundary. It deliberately never
 * includes filenames, filesystem paths, image bytes, or a nested decoder error.
 */
export class ImagePipelineError extends Error {
  readonly code: ImageErrorCode;
  readonly retryable = false;

  constructor(code: ImageErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "ImagePipelineError";
    this.code = code;
  }
}

export interface SafeImageError {
  code: ImageErrorCode;
  message: string;
  retryable: false;
}

export function toSafeImageError(error: unknown): SafeImageError {
  const safeError =
    error instanceof ImagePipelineError
      ? error
      : new ImagePipelineError("storage_unavailable");

  return {
    code: safeError.code,
    message: safeError.message,
    retryable: false,
  };
}
