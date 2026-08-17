import type { ImageAssetRow, Repositories } from "@/lib/db";
import { createRepositories } from "@/lib/db";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { ImagePipelineError, type EncryptedImageAssetRecord } from "@/lib/images";
import { logger } from "@/lib/logging/logger";

import { encryptedRecordFromRow, getImageTools } from "./images";

const DEFAULT_SWEEP_LIMIT = 50;
const MAX_SWEEP_LIMIT = 500;

export type PurgeRecord = (record: EncryptedImageAssetRecord) => Promise<unknown>;

export interface ImagePurgeBatchResult {
  examined: number;
  purged: number;
  blocked: number;
  failed: number;
}

export interface RetentionSweepOptions {
  /** Pending rows are always reconciled; this controls expiry claims only. */
  includeExpired?: boolean;
  at?: string;
  limit?: number;
  repositories?: Repositories;
  purgeRecord?: PurgeRecord;
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SWEEP_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0) return DEFAULT_SWEEP_LIMIT;
  return Math.min(value, MAX_SWEEP_LIMIT);
}

function safeFailureCode(error: unknown): string {
  if (error instanceof ImagePipelineError) return error.code;
  if (error instanceof Error) {
    if (error.name === "SqliteError" || error.name.startsWith("Persistence")) {
      return "database_error";
    }
  }
  return "retention_purge_failed";
}

async function purgeClaimedImage(
  row: ImageAssetRow,
  repositories: Repositories,
  purgeRecord: PurgeRecord,
): Promise<"purged" | "blocked" | "failed"> {
  const claimed = repositories.reviews.tryClaimImageForPurge(row.id);
  if (!claimed) {
    const current = repositories.reviews.getImageAsset(row.id);
    return current?.retentionState === "purged" ? "purged" : "blocked";
  }

  let record: EncryptedImageAssetRecord | null;
  try {
    record = encryptedRecordFromRow(claimed);
  } catch (error) {
    logger.warn({
      event: "image_retention.purge_failed",
      errorCode: safeFailureCode(error),
    });
    return "failed";
  }
  if (!record) {
    // Both null locators mean there is no ciphertext left to remove. This also
    // completes reconciliation after a crash between unlink and DB finalisation.
    if (
      claimed.storageLocator === null &&
      claimed.thumbnailStorageLocator === null
    ) {
      repositories.reviews.markImagePurged(claimed.id);
      return "purged";
    }
    logger.warn({
      event: "image_retention.purge_failed",
      errorCode: "invalid_storage_record",
    });
    return "failed";
  }

  try {
    // The encrypted store removes both the analysis and preview blobs. It is
    // idempotent, allowing a purge_pending row to recover after partial unlink.
    await purgeRecord(record);
    repositories.reviews.markImagePurged(claimed.id);
    return "purged";
  } catch (error) {
    logger.warn({
      event: "image_retention.purge_failed",
      errorCode: safeFailureCode(error),
    });
    return "failed";
  }
}

/**
 * Claims, deletes, and finalises a bounded list of image assets. Callers may
 * pass retained or purge_pending rows; claims are rechecked atomically.
 */
export async function purgeImageAssets(
  imageAssetIds: readonly string[],
  options: Omit<RetentionSweepOptions, "includeExpired" | "at"> = {},
): Promise<ImagePurgeBatchResult> {
  const repositories = options.repositories ?? createRepositories();
  const limit = boundedLimit(options.limit);
  const ids = [...new Set(imageAssetIds)].slice(0, limit);
  const result: ImagePurgeBatchResult = {
    examined: 0,
    purged: 0,
    blocked: 0,
    failed: 0,
  };
  let purgeRecord = options.purgeRecord;

  for (const imageAssetId of ids) {
    const row = repositories.reviews.getImageAsset(imageAssetId);
    if (!row) continue;
    result.examined += 1;

    if (!purgeRecord && row.storageLocator !== null) {
      purgeRecord = (record) => getImageTools().store.purge(record);
    }
    const outcome = await purgeClaimedImage(
      row,
      repositories,
      purgeRecord ?? (async () => undefined),
    );
    result[outcome] += 1;
  }

  return result;
}

/** Reconciles pending purges first, then claims expired retained assets. */
export async function runRetentionSweep(
  options: RetentionSweepOptions = {},
): Promise<ImagePurgeBatchResult> {
  const repositories = options.repositories ?? createRepositories();
  const limit = boundedLimit(options.limit);
  const includeExpired =
    options.includeExpired ?? Boolean(getRuntimeConfig().imageRetentionHours);
  const pending = repositories.reviews.listPurgePendingImages(limit);
  const remaining = limit - pending.length;
  const expired =
    includeExpired && remaining > 0
      ? repositories.reviews.listExpiredRetainedImages(
          options.at ?? new Date().toISOString(),
          remaining,
        )
      : [];
  const candidates = [...pending, ...expired];

  if (candidates.length === 0) {
    return { examined: 0, purged: 0, blocked: 0, failed: 0 };
  }

  logger.info({
    event: "image_retention.sweep_started",
    inputCount: candidates.length,
  });
  const result = await purgeImageAssets(
    candidates.map(({ id }) => id),
    {
      repositories,
      purgeRecord: options.purgeRecord,
      limit,
    },
  );
  logger.info({
    event: "image_retention.sweep_completed",
    inputCount: result.examined,
    ...(result.failed > 0 ? { errorCode: "retention_purge_failed" } : {}),
  });
  return result;
}

let activeSweep: Promise<void> | undefined;

/** Starts one coalesced sweep without holding up startup or a request. */
export function kickRetentionSweep(): void {
  if (activeSweep) return;
  activeSweep = runRetentionSweep()
    .then(() => undefined)
    .catch((error: unknown) => {
      logger.error({
        event: "image_retention.sweep_failed",
        errorCode: safeFailureCode(error),
      });
    })
    .finally(() => {
      activeSweep = undefined;
    });
}
