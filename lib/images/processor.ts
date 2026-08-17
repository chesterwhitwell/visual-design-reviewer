import { createHash } from "node:crypto";

import { fileTypeFromBuffer } from "file-type";
import sharp, { type Sharp } from "sharp";

import { validateImageContainer } from "./container-validation";
import { ImagePipelineError } from "./errors";
import { assertValidImageProcessingLimits } from "./limits";
import type {
  ImageProcessingLimits,
  ImageProcessor,
  ImageUploadInput,
  ProcessedImage,
  ProcessedImageVariant,
  SupportedImageMimeType,
} from "./types";

const MIME_TO_SHARP_FORMAT: Readonly<
  Record<SupportedImageMimeType, "jpeg" | "png" | "webp">
> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

function isSupportedMimeType(value: string): value is SupportedImageMimeType {
  return Object.hasOwn(MIME_TO_SHARP_FORMAT, value);
}

function normaliseDeclaredMimeType(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") {
    return null;
  }
  return value.split(";", 1)[0].trim().toLowerCase();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isPixelLimitDecoderError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /pixel limit|exceeds.*pixels|image exceeds/i.test(error.message)
  );
}

function decoderError(error: unknown): ImagePipelineError {
  return new ImagePipelineError(
    isPixelLimitDecoderError(error) ? "pixel_limit_exceeded" : "corrupt_image",
  );
}

function assertDimensions(
  width: number | undefined,
  height: number | undefined,
  limits: ImageProcessingLimits,
): asserts width is number {
  if (
    width == null ||
    height == null ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new ImagePipelineError("corrupt_image");
  }

  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxPixels) {
    throw new ImagePipelineError("pixel_limit_exceeded");
  }
  if (width > limits.maxWidth || height > limits.maxHeight) {
    throw new ImagePipelineError("dimension_limit_exceeded");
  }
}

function configureAnalysisOutput(
  pipeline: Sharp,
  mimeType: SupportedImageMimeType,
): Sharp {
  switch (mimeType) {
    case "image/jpeg":
      return pipeline.jpeg({
        quality: 95,
        chromaSubsampling: "4:4:4",
        progressive: false,
        optimiseCoding: true,
      });
    case "image/png":
      return pipeline.png({
        compressionLevel: 6,
        adaptiveFiltering: true,
        palette: false,
      });
    case "image/webp":
      return pipeline.webp({
        quality: 95,
        alphaQuality: 100,
        smartSubsample: true,
        effort: 4,
      });
  }
}

async function assertMetadataWasRemoved(bytes: Buffer): Promise<void> {
  let metadata;
  try {
    metadata = await sharp(bytes, { failOn: "warning" }).metadata();
  } catch (error) {
    throw decoderError(error);
  }

  if (
    metadata.exif != null ||
    metadata.icc != null ||
    metadata.iptc != null ||
    metadata.xmp != null ||
    metadata.orientation != null ||
    (metadata.pages != null && metadata.pages > 1)
  ) {
    // This indicates an encoder/configuration regression, but remains a safe
    // rejection at the trust boundary rather than releasing metadata.
    throw new ImagePipelineError("corrupt_image");
  }
}

function variant(
  bytes: Buffer,
  mimeType: SupportedImageMimeType,
  width: number,
  height: number,
): ProcessedImageVariant {
  return {
    bytes,
    mimeType,
    width,
    height,
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

/**
 * Strict, memory-bounded image sanitiser. Limits are mandatory so product
 * deployments must make their upload policy explicit.
 */
export class SharpImageProcessor implements ImageProcessor {
  readonly limits: Readonly<ImageProcessingLimits>;

  constructor(limits: ImageProcessingLimits) {
    assertValidImageProcessingLimits(limits);
    this.limits = Object.freeze({ ...limits });

    // libvips' operation cache can retain decoded pixels after the request.
    sharp.cache(false);
  }

  async process(input: ImageUploadInput): Promise<ProcessedImage> {
    if (input.bytes.byteLength === 0) {
      throw new ImagePipelineError("input_empty");
    }
    if (input.bytes.byteLength > this.limits.maxInputBytes) {
      throw new ImagePipelineError("input_too_large");
    }

    // Work from a private copy so it can be wiped after sanitisation without
    // mutating the caller's upload buffer.
    const inputBytes = Buffer.from(input.bytes);
    try {
      return await this.processCopiedBytes(inputBytes, input.declaredMimeType);
    } finally {
      inputBytes.fill(0);
    }
  }

  private async processCopiedBytes(
    inputBytes: Buffer,
    declaredMimeType: string | null | undefined,
  ): Promise<ProcessedImage> {
    let detected;
    try {
      detected = await fileTypeFromBuffer(inputBytes);
    } catch {
      throw new ImagePipelineError("unsupported_type");
    }

    if (detected == null || !isSupportedMimeType(detected.mime)) {
      throw new ImagePipelineError("unsupported_type");
    }
    const mimeType = detected.mime;

    const declared = normaliseDeclaredMimeType(declaredMimeType);
    if (
      declared != null &&
      declared !== "application/octet-stream" &&
      declared !== mimeType
    ) {
      throw new ImagePipelineError("type_mismatch");
    }

    validateImageContainer(inputBytes, mimeType);

    let metadata;
    try {
      metadata = await sharp(inputBytes, {
        failOn: "warning",
        limitInputPixels: this.limits.maxPixels,
        sequentialRead: true,
      }).metadata();
    } catch (error) {
      throw decoderError(error);
    }

    if (metadata.format !== MIME_TO_SHARP_FORMAT[mimeType]) {
      throw new ImagePipelineError("type_mismatch");
    }
    if (
      (metadata.pages != null && metadata.pages > 1) ||
      (metadata.delay != null && metadata.delay.length > 1)
    ) {
      throw new ImagePipelineError("animated_image");
    }

    const autoOriented = metadata.autoOrient;
    const orientedWidth = autoOriented?.width ?? metadata.width;
    const orientedHeight = autoOriented?.height ?? metadata.height;
    assertDimensions(orientedWidth, orientedHeight, this.limits);

    let analysisResult;
    try {
      const pipeline = sharp(inputBytes, {
        failOn: "warning",
        limitInputPixels: this.limits.maxPixels,
        sequentialRead: true,
      })
        .rotate()
        .toColourspace("srgb");
      analysisResult = await configureAnalysisOutput(pipeline, mimeType).toBuffer({
        resolveWithObject: true,
      });
    } catch (error) {
      throw decoderError(error);
    }

    const analysisBytes = analysisResult.data;
    if (analysisBytes.byteLength > this.limits.maxSanitizedBytes) {
      analysisBytes.fill(0);
      throw new ImagePipelineError("sanitized_too_large");
    }

    const width = analysisResult.info.width;
    const height = analysisResult.info.height;
    try {
      assertDimensions(width, height, this.limits);
      await assertMetadataWasRemoved(analysisBytes);

      let previewResult;
      try {
        previewResult = await sharp(analysisBytes, {
          failOn: "warning",
          limitInputPixels: this.limits.maxPixels,
          sequentialRead: true,
        })
          .resize({
            width: this.limits.previewMaxWidth,
            height: this.limits.previewMaxHeight,
            fit: "inside",
            withoutEnlargement: true,
          })
          .webp({ quality: 85, alphaQuality: 90, smartSubsample: true, effort: 4 })
          .toBuffer({ resolveWithObject: true });
      } catch (error) {
        throw decoderError(error);
      }

      const previewBytes = previewResult.data;
      if (previewBytes.byteLength > this.limits.maxPreviewBytes) {
        previewBytes.fill(0);
        throw new ImagePipelineError("preview_too_large");
      }

      try {
        await assertMetadataWasRemoved(previewBytes);
        const processed = variant(analysisBytes, mimeType, width, height);
        return {
          ...processed,
          preview: variant(
            previewBytes,
            "image/webp",
            previewResult.info.width,
            previewResult.info.height,
          ),
        };
      } catch (error) {
        previewBytes.fill(0);
        throw error;
      }
    } catch (error) {
      analysisBytes.fill(0);
      throw error;
    }
  }
}

/** Zero the caller-owned sanitised and preview buffers after their last use. */
export function wipeProcessedImage(image: ProcessedImage): void {
  image.bytes.fill(0);
  if (image.preview.bytes !== image.bytes) {
    image.preview.bytes.fill(0);
  }
}
