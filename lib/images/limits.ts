import { ImagePipelineError } from "./errors";
import type {
  ImageBatchLimits,
  ImageProcessingLimits,
  ImageUploadInput,
} from "./types";

const PROCESSING_LIMIT_KEYS = [
  "maxInputBytes",
  "maxPixels",
  "maxWidth",
  "maxHeight",
  "maxSanitizedBytes",
  "previewMaxWidth",
  "previewMaxHeight",
  "maxPreviewBytes",
] as const satisfies readonly (keyof ImageProcessingLimits)[];

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function assertValidImageProcessingLimits(
  limits: ImageProcessingLimits,
): void {
  if (
    PROCESSING_LIMIT_KEYS.some((key) => !isPositiveSafeInteger(limits[key]))
  ) {
    throw new ImagePipelineError("invalid_limits");
  }
}

export function assertImageBatchWithinLimits(
  images: readonly ImageUploadInput[],
  limits: ImageBatchLimits,
): void {
  if (
    !isPositiveSafeInteger(limits.maxImages) ||
    !isPositiveSafeInteger(limits.maxTotalBytes)
  ) {
    throw new ImagePipelineError("invalid_limits");
  }

  if (images.length > limits.maxImages) {
    throw new ImagePipelineError("too_many_images");
  }

  let totalBytes = 0;
  for (const image of images) {
    totalBytes += image.bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw new ImagePipelineError("aggregate_too_large");
    }
  }
}

