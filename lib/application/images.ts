import { resolve } from "node:path";

import { createRepositories, type ImageAssetRow } from "@/lib/db";
import { getRuntimeConfig } from "@/lib/config/runtime";
import type { ImageAnalysisRole } from "@/lib/domain";
import { AppError } from "@/lib/http/errors";
import {
  ImagePipelineError,
  LocalEncryptedImageStore,
  SharpImageProcessor,
  assertImageBatchWithinLimits,
  parseImageEncryptionKey,
  wipeProcessedImage,
  type EncryptedImageAssetRecord,
  type ImageUploadInput,
} from "@/lib/images";

type UploadedImage = {
  bytes: Buffer;
  declaredMimeType?: string | null;
  displayName: string;
};

let cachedTools:
  | {
      processor: SharpImageProcessor;
      store: LocalEncryptedImageStore;
    }
  | undefined;

export function getImageTools() {
  if (cachedTools) return cachedTools;
  const config = getRuntimeConfig();
  let key: Buffer;
  try {
    key = parseImageEncryptionKey(config.imageEncryptionKey);
  } catch (error) {
    throw new AppError(
      "configuration_error",
      "A valid server-side IMAGE_ENCRYPTION_KEY is required before images can be retained.",
      { cause: error },
    );
  }
  try {
    cachedTools = {
      processor: new SharpImageProcessor({
        maxInputBytes: config.limits.imageBytes,
        maxPixels: config.limits.imagePixels,
        maxWidth: config.limits.imageWidth,
        maxHeight: config.limits.imageHeight,
        maxSanitizedBytes: config.limits.sanitizedImageBytes,
        previewMaxWidth: config.limits.previewWidth,
        previewMaxHeight: config.limits.previewHeight,
        maxPreviewBytes: config.limits.previewBytes,
      }),
      store: new LocalEncryptedImageStore({
        directory: resolve(config.imageStoragePath),
        key,
        maxPlaintextBytes: Math.max(
          config.limits.sanitizedImageBytes,
          config.limits.previewBytes,
        ),
      }),
    };
    return cachedTools;
  } finally {
    key.fill(0);
  }
}

export function resetImageToolsForTests(): void {
  cachedTools = undefined;
}

export async function addImagesToReview(
  reviewId: string,
  uploads: UploadedImage[],
) {
  const config = getRuntimeConfig();
  const repositories = createRepositories();
  repositories.reviews.requireById(reviewId);

  const latest = repositories.reviews.getLatestImageRevision(reviewId);
  const currentImages = latest?.images ?? [];
  if (currentImages.length + uploads.length > config.limits.imagesPerReview) {
    throw new AppError(
      "image_invalid",
      `A review can contain at most ${config.limits.imagesPerReview} images.`,
    );
  }

  const imageInputs: ImageUploadInput[] = uploads.map((upload) => ({
    bytes: upload.bytes,
    declaredMimeType: upload.declaredMimeType,
  }));
  try {
    assertImageBatchWithinLimits(imageInputs, {
      maxImages: config.limits.imagesPerReview,
      maxTotalBytes: config.limits.totalImageBytes,
    });
  } catch (error) {
    throw imageAppError(error);
  }

  const { processor, store } = getImageTools();
  const created: Array<{
    databaseId: string;
    encrypted: EncryptedImageAssetRecord;
  }> = [];

  try {
    for (const upload of uploads) {
      let processed;
      try {
        processed = await processor.process({
          bytes: upload.bytes,
          declaredMimeType: upload.declaredMimeType,
        });
      } catch (error) {
        throw imageAppError(error);
      }

      try {
        const encrypted = await store.put(processed);
        const expiresAt = config.imageRetentionHours
          ? new Date(Date.now() + config.imageRetentionHours * 3_600_000).toISOString()
          : null;
        try {
          const row = repositories.reviews.createImageAsset({
            id: encrypted.assetId,
            reviewId,
            displayName: sanitiseDisplayName(upload.displayName),
            originalFilename: null,
            contentDigest: encrypted.sha256,
            mimeType: encrypted.mimeType,
            width: encrypted.width,
            height: encrypted.height,
            byteSize: encrypted.analysis.plaintextBytes,
            storageLocator: JSON.stringify(encrypted),
            thumbnailStorageLocator: encrypted.preview.locator,
            encryptionVersion: encrypted.version,
            expiresAt,
          });
          created.push({ databaseId: row.id, encrypted });
        } catch (error) {
          await store.purge(encrypted).catch(() => undefined);
          throw error;
        }
      } finally {
        wipeProcessedImage(processed);
      }
    }

    const imageItems = [
      ...currentImages.map(({ asset, analysisRole }) => ({
        imageAssetId: asset.id,
        analysisRole,
      })),
      ...created.map(({ databaseId }) => ({
        imageAssetId: databaseId,
        analysisRole: "final_work" as const,
      })),
    ];
    return repositories.reviews.createImageRevision(
      reviewId,
      imageItems.map((item, index) => ({
        ...item,
        imageLabel: `image_${index + 1}`,
      })),
    );
  } catch (error) {
    for (const item of created) {
      await store.purge(item.encrypted).catch(() => undefined);
      try {
        repositories.reviews.markImagePurgePending(item.databaseId);
        repositories.reviews.markImagePurged(item.databaseId);
      } catch {
        // Preserve the original safe failure; startup retention can reconcile the row.
      }
    }
    throw error;
  } finally {
    for (const upload of uploads) upload.bytes.fill(0);
  }
}

export function replaceImageOrder(reviewId: string, imageIds: string[]) {
  const repositories = createRepositories();
  const latest = repositories.reviews.getLatestImageRevision(reviewId);
  if (!latest) {
    throw new AppError("not_found", "This review has no image revision.");
  }
  const existingIds = latest.images.map(({ asset }) => asset.id);
  if (
    imageIds.length !== existingIds.length ||
    new Set(imageIds).size !== imageIds.length ||
    imageIds.some((id) => !existingIds.includes(id))
  ) {
    throw new AppError("bad_request", "Image order must contain every current image exactly once.");
  }
  const roleById = new Map(
    latest.images.map(({ asset, analysisRole }) => [asset.id, analysisRole]),
  );
  return replaceImageManifest(
    reviewId,
    imageIds.map((imageId) => ({
      imageId,
      analysisRole: roleById.get(imageId) ?? "final_work",
    })),
  );
}

export function replaceImageManifest(
  reviewId: string,
  images: Array<{ imageId: string; analysisRole: ImageAnalysisRole }>,
) {
  const repositories = createRepositories();
  const latest = repositories.reviews.getLatestImageRevision(reviewId);
  if (!latest) {
    throw new AppError("not_found", "This review has no image revision.");
  }
  const existingIds = latest.images.map(({ asset }) => asset.id);
  const requestedIds = images.map(({ imageId }) => imageId);
  if (
    requestedIds.length !== existingIds.length ||
    new Set(requestedIds).size !== requestedIds.length ||
    requestedIds.some((id) => !existingIds.includes(id))
  ) {
    throw new AppError(
      "bad_request",
      "The image manifest must contain every current image exactly once.",
    );
  }
  return repositories.reviews.createImageRevision(
    reviewId,
    images.map(({ imageId, analysisRole }, index) => ({
      imageAssetId: imageId,
      imageLabel: `image_${index + 1}`,
      analysisRole,
    })),
  );
}

export function removeImageFromReview(reviewId: string, imageId: string) {
  const repositories = createRepositories();
  const latest = repositories.reviews.getLatestImageRevision(reviewId);
  if (!latest || !latest.images.some(({ asset }) => asset.id === imageId)) {
    throw new AppError("not_found", "The image is not part of the current review revision.");
  }
  const remaining = latest.images.filter(({ asset }) => asset.id !== imageId);
  return repositories.reviews.createImageRevision(
    reviewId,
    remaining.map(({ asset, analysisRole }, index) => ({
      imageAssetId: asset.id,
      imageLabel: `image_${index + 1}`,
      analysisRole,
    })),
  );
}

export async function readPreview(imageId: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const repositories = createRepositories();
  const row = repositories.reviews.getImageAsset(imageId);
  const record = row ? encryptedRecordFromRow(row) : null;
  if (!row || !record || row.retentionState !== "retained") {
    throw new AppError("image_missing", "The retained preview is no longer available.");
  }
  const bytes = await getImageTools().store.readPreview(record).catch((error) => {
    throw imageAppError(error, "image_missing");
  });
  return { bytes, mimeType: record.previewMimeType };
}

export async function purgeReviewImages(reviewId: string): Promise<{ purged: number }> {
  const repositories = createRepositories();
  repositories.reviews.requireById(reviewId);
  const assets = repositories.reviews
    .listImageAssets(reviewId)
    .filter(({ retentionState }) => retentionState !== "purged");
  const activeRuns = repositories.analysisRuns
    .listByReview(reviewId)
    .filter(({ state }) => state === "queued" || state === "running");
  if (activeRuns.length > 0) {
    throw new AppError(
      "conflict",
      "Source images cannot be purged while an analysis run is queued or running.",
    );
  }

  // The retention service performs the active-run check and retained ->
  // purge_pending transition in one immediate transaction. This second check
  // closes the race between the review-wide user-facing guard above and unlink.
  const { purgeImageAssets } = await import("./retention");
  const result = await purgeImageAssets(
    assets.map(({ id }) => id),
    { repositories, limit: Math.max(assets.length, 1) },
  );
  if (result.blocked > 0) {
    throw new AppError(
      "conflict",
      "Source images cannot be purged while an analysis run is queued or running.",
    );
  }
  if (result.failed > 0) {
    throw new AppError(
      "internal_error",
      "One or more retained images could not be fully purged. The server will retry safely.",
      { retryable: true },
    );
  }
  return { purged: result.purged };
}

export function encryptedRecordFromRow(row: ImageAssetRow): EncryptedImageAssetRecord | null {
  if (!row.storageLocator) return null;
  try {
    return JSON.parse(row.storageLocator) as EncryptedImageAssetRecord;
  } catch {
    throw new AppError("image_missing", "The retained image record is invalid.");
  }
}

function sanitiseDisplayName(value: string): string {
  const leaf = value.split(/[\\/]/).at(-1) ?? "Uploaded image";
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "Uploaded image").slice(0, 240);
}

function imageAppError(error: unknown, fallback: "image_invalid" | "image_missing" = "image_invalid") {
  if (error instanceof AppError) return error;
  if (error instanceof ImagePipelineError) {
    return new AppError(fallback, error.message, {
      retryable: false,
      details: { imageCode: error.code },
      cause: error,
    });
  }
  return new AppError(fallback, "The image could not be processed safely.", { cause: error });
}
