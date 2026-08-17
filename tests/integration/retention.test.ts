import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  purgeImageAssets,
  runRetentionSweep,
} from "@/lib/application/retention";
import { deleteReviewAndFiles } from "@/lib/application/review-deletion";
import {
  createRepositories,
  openDatabase,
  type DatabaseHandle,
  type Repositories,
} from "@/lib/db";
import { migrateDatabase } from "@/lib/db/migrate";
import {
  LocalEncryptedImageStore,
  type EncryptedImageAssetRecord,
  type ProcessedImage,
} from "@/lib/images";

const NOW = "2026-08-15T12:00:00.000Z";
const EXPIRED = "2026-08-15T11:00:00.000Z";

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fakeRecord(id: string): EncryptedImageAssetRecord {
  const sha256 = "a".repeat(64);
  return {
    version: 1,
    assetId: id,
    mimeType: "image/png",
    width: 10,
    height: 10,
    sha256,
    previewMimeType: "image/png",
    previewWidth: 5,
    previewHeight: 5,
    analysis: {
      version: 1,
      locator: `${"1".repeat(32)}.vdr`,
      kind: "analysis",
      plaintextBytes: 10,
      ciphertextBytes: 43,
      sha256,
    },
    preview: {
      version: 1,
      locator: `${"2".repeat(32)}.vdr`,
      kind: "preview",
      plaintextBytes: 5,
      ciphertextBytes: 38,
      sha256,
    },
  };
}

describe("automatic image retention", () => {
  let directory: string;
  let handle: DatabaseHandle;
  let repositories: Repositories;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "design-review-retention-"));
    handle = openDatabase({ path: join(directory, "test.sqlite") });
    migrateDatabase(handle);
    repositories = createRepositories(handle.db, { clock: () => NOW });
    repositories.reviews.create({ id: "review-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    handle.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("never purges an image used by an active run and rejects enqueue after a claim", async () => {
    const record = fakeRecord("image-1");
    repositories.reviews.createImageAsset({
      id: "image-1",
      reviewId: "review-1",
      contentDigest: record.sha256,
      mimeType: "image/png",
      width: 10,
      height: 10,
      byteSize: 10,
      storageLocator: JSON.stringify(record),
      thumbnailStorageLocator: record.preview.locator,
    });
    repositories.reviews.createImageRevision(
      "review-1",
      [{ imageAssetId: "image-1" }],
      "revision-1",
    );
    repositories.analysisRuns.create({
      id: "run-active",
      reviewId: "review-1",
      kind: "design",
      imageRevisionId: "revision-1",
      inputSnapshot: { images: [{ id: "image-1" }] },
      passes: [{ id: "pass-active", key: "D1", position: 0 }],
    });

    expect(repositories.reviews.tryClaimImageForPurge("image-1")).toBeNull();
    expect(repositories.reviews.getImageAsset("image-1")?.retentionState).toBe(
      "retained",
    );

    // Simulate a purge_pending row left by an older process. Reconciliation
    // must still recheck the active-run invariant before touching ciphertext.
    handle.sqlite
      .prepare(
        "update image_assets set retention_state = 'purge_pending', purge_requested_at = ? where id = ?",
      )
      .run(NOW, "image-1");
    const purgeRecord = vi.fn(async () => undefined);
    await expect(
      runRetentionSweep({
        repositories,
        purgeRecord,
        includeExpired: false,
      }),
    ).resolves.toMatchObject({ blocked: 1, purged: 0 });
    expect(purgeRecord).not.toHaveBeenCalled();

    repositories.analysisRuns.requestCancellation("run-active");
    expect(() =>
      repositories.analysisRuns.create({
        id: "run-too-late",
        reviewId: "review-1",
        kind: "design",
        imageRevisionId: "revision-1",
        inputSnapshot: { images: [{ id: "image-1" }] },
        passes: [{ id: "pass-too-late", key: "D1", position: 0 }],
      }),
    ).toThrow(/must still be locally retained/i);

    await expect(
      runRetentionSweep({
        repositories,
        purgeRecord,
        includeExpired: false,
      }),
    ).resolves.toMatchObject({ blocked: 0, purged: 1 });
    expect(purgeRecord).toHaveBeenCalledTimes(1);
    expect(repositories.reviews.getImageAsset("image-1")).toMatchObject({
      retentionState: "purged",
      storageLocator: null,
      thumbnailStorageLocator: null,
    });
  });

  it("deletes both ciphertexts before clearing locators and reconciles missing files", async () => {
    const analysisBytes = Buffer.from("sanitised analysis bytes");
    const previewBytes = Buffer.from("preview bytes");
    const processed: ProcessedImage = {
      bytes: analysisBytes,
      mimeType: "image/png",
      width: 20,
      height: 10,
      byteLength: analysisBytes.byteLength,
      sha256: digest(analysisBytes),
      preview: {
        bytes: previewBytes,
        mimeType: "image/png",
        width: 10,
        height: 5,
        byteLength: previewBytes.byteLength,
        sha256: digest(previewBytes),
      },
    };
    const storeDirectory = join(directory, "images");
    const key = randomBytes(32);
    const store = new LocalEncryptedImageStore({
      directory: storeDirectory,
      key,
      maxPlaintextBytes: 1_024,
    });
    const record = await store.put(processed);
    repositories.reviews.createImageAsset({
      id: record.assetId,
      reviewId: "review-1",
      contentDigest: record.sha256,
      mimeType: record.mimeType,
      width: record.width,
      height: record.height,
      byteSize: record.analysis.plaintextBytes,
      storageLocator: JSON.stringify(record),
      thumbnailStorageLocator: record.preview.locator,
      expiresAt: EXPIRED,
    });

    const first = await runRetentionSweep({
      repositories,
      includeExpired: true,
      at: NOW,
      purgeRecord: (candidate) => store.purge(candidate),
    });
    expect(first).toMatchObject({ examined: 1, purged: 1, failed: 0 });
    await expect(readdir(storeDirectory)).resolves.toEqual([]);
    expect(repositories.reviews.getImageAsset(record.assetId)).toMatchObject({
      retentionState: "purged",
      storageLocator: null,
      thumbnailStorageLocator: null,
      purgedAt: NOW,
    });

    // An interrupted process may have removed ciphertext before finalising the
    // DB row. The store's already-missing result lets a later sweep finish it.
    const secondRecord = await store.put(processed);
    repositories.reviews.createImageAsset({
      id: secondRecord.assetId,
      reviewId: "review-1",
      contentDigest: secondRecord.sha256,
      mimeType: secondRecord.mimeType,
      width: secondRecord.width,
      height: secondRecord.height,
      byteSize: secondRecord.analysis.plaintextBytes,
      storageLocator: JSON.stringify(secondRecord),
      thumbnailStorageLocator: secondRecord.preview.locator,
    });
    repositories.reviews.markImagePurgePending(secondRecord.assetId);
    await store.purge(secondRecord);

    await expect(
      runRetentionSweep({
        repositories,
        includeExpired: false,
        purgeRecord: (candidate) => store.purge(candidate),
      }),
    ).resolves.toMatchObject({ purged: 1, failed: 0 });
    expect(
      repositories.reviews.getImageAsset(secondRecord.assetId)?.retentionState,
    ).toBe("purged");

    key.fill(0);
    analysisBytes.fill(0);
    previewBytes.fill(0);
  });

  it("does not reactivate a failed run after its source image is claimed", () => {
    const record = fakeRecord("image-retry");
    repositories.reviews.createImageAsset({
      id: "image-retry",
      reviewId: "review-1",
      contentDigest: record.sha256,
      mimeType: "image/png",
      width: 10,
      height: 10,
      byteSize: 10,
      storageLocator: JSON.stringify(record),
      thumbnailStorageLocator: record.preview.locator,
    });
    repositories.reviews.createImageRevision(
      "review-1",
      [{ imageAssetId: "image-retry" }],
      "revision-retry",
    );
    repositories.analysisRuns.create({
      id: "run-retry",
      reviewId: "review-1",
      kind: "design",
      imageRevisionId: "revision-retry",
      inputSnapshot: { images: [{ id: "image-retry" }] },
      passes: [{ id: "pass-retry", key: "D1", position: 0 }],
    });
    repositories.analysisRuns.claimNextQueued("worker", 30_000);
    repositories.analysisRuns.beginPassAttempt("pass-retry", {
      id: "attempt-retry",
      provider: "openai",
      model: "configured-model",
      promptVersion: "d1.v1",
      schemaVersion: "d1.v1",
    });
    repositories.analysisRuns.failPassAttempt("attempt-retry", {
      failure: { code: "upstream_unavailable", message: "Retry later." },
      durationMs: 1,
    });
    repositories.analysisRuns.transitionRun("run-retry", "failed", {
      code: "upstream_unavailable",
      message: "Retry later.",
    });

    expect(
      repositories.reviews.tryClaimImageForPurge("image-retry")?.retentionState,
    ).toBe("purge_pending");
    expect(() => repositories.analysisRuns.retryPass("pass-retry")).toThrow(
      /retried analysis run must still be locally retained/i,
    );
    expect(repositories.analysisRuns.requireById("run-retry").state).toBe("failed");
  });

  it("bounds each sweep and retries purge_pending failures", async () => {
    for (const id of ["image-1", "image-2", "image-3"]) {
      const record = fakeRecord(id);
      repositories.reviews.createImageAsset({
        id,
        reviewId: "review-1",
        contentDigest: record.sha256,
        mimeType: "image/png",
        width: 10,
        height: 10,
        byteSize: 10,
        storageLocator: JSON.stringify(record),
        thumbnailStorageLocator: record.preview.locator,
        expiresAt: EXPIRED,
      });
    }

    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failingPurge = vi.fn(async () => {
      throw new Error("private filesystem detail that must not be logged");
    });
    const first = await runRetentionSweep({
      repositories,
      includeExpired: true,
      at: NOW,
      limit: 2,
      purgeRecord: failingPurge,
    });
    expect(first).toEqual({ examined: 2, purged: 0, blocked: 0, failed: 2 });
    expect(
      repositories.reviews.listPurgePendingImages().map(({ id }) => id),
    ).toHaveLength(2);
    expect(repositories.reviews.listExpiredRetainedImages(NOW)).toHaveLength(1);
    expect(warning.mock.calls.flat().join(" ")).not.toContain(
      "private filesystem detail",
    );

    const successfulPurge = vi.fn(async () => undefined);
    const second = await runRetentionSweep({
      repositories,
      includeExpired: false,
      limit: 1,
      purgeRecord: successfulPurge,
    });
    expect(second).toEqual({ examined: 1, purged: 1, blocked: 0, failed: 0 });
    expect(successfulPurge).toHaveBeenCalledTimes(1);
    expect(repositories.reviews.listPurgePendingImages()).toHaveLength(1);

    const direct = await purgeImageAssets(["image-3"], {
      repositories,
      purgeRecord: successfulPurge,
    });
    expect(direct).toMatchObject({ examined: 1, purged: 1 });
  });

  it("keeps a failed deletion closed and retryable until every file is purged", async () => {
    const record = fakeRecord("image-delete-retry");
    repositories.reviews.createImageAsset({
      id: record.assetId,
      reviewId: "review-1",
      contentDigest: record.sha256,
      mimeType: record.mimeType,
      width: record.width,
      height: record.height,
      byteSize: record.analysis.plaintextBytes,
      storageLocator: JSON.stringify(record),
      thumbnailStorageLocator: record.preview.locator,
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      deleteReviewAndFiles(
        "review-1",
        { confirmation: "DELETE" },
        {
          repositories,
          purgeRecord: async () => {
            throw new Error("private storage failure");
          },
        },
      ),
    ).rejects.toMatchObject({ code: "internal_error", retryable: true });
    expect(repositories.reviews.requireById("review-1").lifecycle).toBe("closed");
    expect(repositories.reviews.getImageAsset(record.assetId)?.retentionState).toBe(
      "purge_pending",
    );
    expect(warning.mock.calls.flat().join(" ")).not.toContain("private storage failure");

    await expect(
      deleteReviewAndFiles(
        "review-1",
        { confirmation: "DELETE" },
        { repositories, purgeRecord: async () => undefined },
      ),
    ).resolves.toEqual({ reviewId: "review-1", deletedImages: 1 });
    expect(repositories.reviews.getById("review-1")).toBeNull();
  });
});
