import { z } from "zod";

import { createRepositories, type Repositories } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { logger } from "@/lib/logging/logger";

import { purgeImageAssets, type PurgeRecord } from "./retention";

const DELETE_BATCH_SIZE = 500;

const deleteReviewConfirmationSchema = z
  .object({ confirmation: z.literal("DELETE") })
  .strict();

export interface DeleteReviewOptions {
  repositories?: Repositories;
  purgeRecord?: PurgeRecord;
}

export interface DeleteReviewResult {
  reviewId: string;
  deletedImages: number;
}

/**
 * Permanently removes a review. The review is first closed under a database
 * write lock, then every encrypted image/preview blob is purged, and only then
 * is its database history deleted. A failed purge leaves a closed, retryable
 * review instead of orphaning ciphertext on disk.
 */
export async function deleteReviewAndFiles(
  reviewId: string,
  input: unknown,
  options: DeleteReviewOptions = {},
): Promise<DeleteReviewResult> {
  deleteReviewConfirmationSchema.parse(input);
  const repositories = options.repositories ?? createRepositories();

  repositories.reviews.beginDeletion(reviewId);
  const assets = repositories.reviews.listImageAssets(reviewId);
  logger.info({
    event: "review.deletion_started",
    reviewId,
    inputCount: assets.length,
  });

  for (let index = 0; index < assets.length; index += DELETE_BATCH_SIZE) {
    const batch = assets.slice(index, index + DELETE_BATCH_SIZE);
    const result = await purgeImageAssets(
      batch.map(({ id }) => id),
      {
        repositories,
        purgeRecord: options.purgeRecord,
        limit: batch.length,
      },
    );
    if (result.blocked > 0) {
      throw new AppError(
        "conflict",
        "The review cannot be deleted while an analysis is queued or running.",
      );
    }
    if (result.failed > 0 || result.examined !== batch.length) {
      throw new AppError(
        "internal_error",
        "One or more associated image files could not be deleted. The review was closed safely; retry deletion to continue.",
        { retryable: true },
      );
    }
  }

  repositories.reviews.deleteReview(reviewId);
  logger.info({
    event: "review.deletion_completed",
    reviewId,
    inputCount: assets.length,
  });
  return { reviewId, deletedImages: assets.length };
}
