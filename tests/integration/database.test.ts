import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeDatabase,
  getDatabaseHandle,
  openDatabase,
  type DatabaseHandle,
} from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import { createRepositories, InvalidStateTransitionError } from "@/lib/db/repositories";

describe("SQLite persistence", () => {
  let directory: string;
  let handle: DatabaseHandle;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "design-review-db-"));
    handle = openDatabase({ path: join(directory, "test.sqlite") });
    migrateDatabase(handle);
  });

  afterEach(() => {
    handle.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("initialises idempotently with WAL mode and foreign keys enabled", () => {
    migrateDatabase(handle);

    expect(handle.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);

    const tableNames = handle.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tableNames).toEqual(
      expect.arrayContaining([
        "analysis_passes",
        "analysis_runs",
        "app_settings",
        "criteria",
        "criteria_analyses",
        "criteria_sets",
        "design_analyses",
        "image_assets",
        "judgement_statements",
        "pass_attempts",
        "review_area_selections",
        "review_image_revision_items",
        "review_image_revisions",
        "reviews",
        "taxonomy_presets",
      ]),
    );

    expect(() =>
      handle.sqlite
        .prepare(
          `insert into image_assets (
            id, review_id, content_digest, mime_type, width, height, byte_size
          ) values (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("orphan", "missing-review", "sha256:orphan", "image/png", 1, 1, 1),
    ).toThrow(/foreign key/i);
  });

  it("lazily migrates the process-wide database singleton", () => {
    const previousPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = join(directory, "singleton.sqlite");
    try {
      const singleton = getDatabaseHandle();
      const table = singleton.sqlite
        .prepare("select name from sqlite_master where type = 'table' and name = 'reviews'")
        .get() as { name: string } | undefined;
      expect(table?.name).toBe("reviews");
      expect(getDatabaseHandle()).toBe(singleton);
    } finally {
      closeDatabase();
      if (previousPath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previousPath;
    }
  });

  it("backfills existing revision items as final work and restores immutability", () => {
    const upgradeHandle = openDatabase({ path: join(directory, "upgrade.sqlite") });
    try {
      for (const migration of [
        "0000_initial.sql",
        "0001_immutable_run_inputs.sql",
        "0002_criteria_sets.sql",
      ]) {
        upgradeHandle.sqlite.exec(
          readFileSync(join(process.cwd(), "lib/db/migrations", migration), "utf8"),
        );
      }
      upgradeHandle.sqlite.prepare("insert into reviews (id) values (?)").run("review-old");
      upgradeHandle.sqlite.prepare(
        `insert into image_assets (
          id, review_id, content_digest, mime_type, width, height, byte_size
        ) values (?, ?, ?, ?, ?, ?, ?)`,
      ).run("image-old", "review-old", "a".repeat(64), "image/png", 100, 100, 100);
      upgradeHandle.sqlite.prepare(
        "insert into review_image_revisions (id, review_id, version) values (?, ?, ?)",
      ).run("revision-old", "review-old", 1);
      upgradeHandle.sqlite.prepare(
        `insert into review_image_revision_items (
          revision_id, image_asset_id, position, image_label
        ) values (?, ?, ?, ?)`,
      ).run("revision-old", "image-old", 0, "image_1");

      upgradeHandle.sqlite.exec(
        readFileSync(
          join(process.cwd(), "lib/db/migrations/0003_image_analysis_roles.sql"),
          "utf8",
        ),
      );
      const row = upgradeHandle.sqlite.prepare(
        "select analysis_role from review_image_revision_items where revision_id = ?",
      ).get("revision-old") as { analysis_role: string };
      expect(row.analysis_role).toBe("final_work");
      expect(() =>
        upgradeHandle.sqlite.prepare(
          "update review_image_revision_items set analysis_role = ? where revision_id = ?",
        ).run("concept_development", "revision-old"),
      ).toThrow(/immutable/i);
    } finally {
      upgradeHandle.close();
    }
  });

  it("stores and restores mutable review configuration and immutable image revisions", () => {
    const repositories = createRepositories(handle.db, {
      clock: () => "2026-08-15T01:02:03.000Z",
    });

    repositories.reviews.create({ id: "review-1", title: "Poster review", context: "A local event" });
    repositories.reviews.createImageAsset({
      id: "image-1",
      reviewId: "review-1",
      displayName: "front",
      contentDigest: "sha256:abc",
      mimeType: "image/png",
      width: 1600,
      height: 1200,
      byteSize: 42_000,
      storageLocator: "cipher/image-1.bin",
      thumbnailStorageLocator: "cipher/image-1-thumb.bin",
      encryptionVersion: 1,
    });

    const firstRevision = repositories.reviews.createImageRevision(
      "review-1",
      [{ imageAssetId: "image-1" }],
      "image-revision-1",
    );
    const emptyRevision = repositories.reviews.createImageRevision(
      "review-1",
      [],
      "image-revision-2",
    );
    expect(firstRevision.version).toBe(1);
    expect(firstRevision.images[0]).toMatchObject({
      position: 0,
      imageLabel: "image_1",
      analysisRole: "final_work",
      asset: { id: "image-1", contentDigest: "sha256:abc" },
    });
    expect(emptyRevision.version).toBe(2);

    repositories.reviews.replaceReviewAreaSelections("review-1", [
      {
        areaId: "typography.hierarchy",
        taxonomyVersion: "v1",
        areaLabel: "Typographic hierarchy",
        mode: "focus",
        position: 0,
      },
      {
        areaId: "colour.contrast",
        taxonomyVersion: "v1",
        areaLabel: "Contrast",
        mode: "review",
        position: 1,
      },
    ]);
    repositories.reviews.replaceCriteria("review-1", [
      {
        id: "criterion-1",
        title: "Hierarchy",
        statement: "Uses hierarchy to guide the reader.",
        position: 0,
        judgementStatements: [
          {
            id: "judgement-1",
            label: "Demonstrated",
            description: "The hierarchy is consistently apparent.",
            position: 0,
          },
        ],
      },
    ]);

    const aggregate = repositories.reviews.getAggregate("review-1");
    expect(aggregate).not.toBeNull();
    expect(aggregate?.imageRevision?.id).toBe("image-revision-2");
    expect(aggregate?.reviewAreas.map((selection) => selection.mode)).toEqual([
      "focus",
      "review",
    ]);
    expect(aggregate?.criteria[0]?.judgementStatements[0]?.label).toBe("Demonstrated");

    expect(() =>
      handle.sqlite
        .prepare("update review_image_revisions set version = 99 where id = ?")
        .run("image-revision-1"),
    ).toThrow(/immutable/i);
    expect(() =>
      handle.sqlite
        .prepare("update review_image_revision_items set analysis_role = ? where revision_id = ?")
        .run("concept_development", "image-revision-1"),
    ).toThrow(/immutable/i);
    expect(() =>
      handle.sqlite
        .prepare("update image_assets set content_digest = ? where id = ?")
        .run("sha256:changed", "image-1"),
    ).toThrow(/immutable/i);

    const purged = repositories.reviews.markImagePurged("image-1");
    expect(purged).toMatchObject({
      retentionState: "purged",
      storageLocator: null,
      thumbnailStorageLocator: null,
    });
    expect(repositories.reviews.requireImageRevision("image-revision-1").images[0]?.asset.id).toBe(
      "image-1",
    );
  });

  it("checkpoints attempts and retries only the failed pass in the same durable run", () => {
    const repositories = createRepositories(handle.db);
    repositories.reviews.create({ id: "review-1" });
    repositories.reviews.createImageAsset({
      id: "image-1",
      reviewId: "review-1",
      contentDigest: "sha256:abc",
      mimeType: "image/jpeg",
      width: 100,
      height: 100,
      byteSize: 500,
    });
    repositories.reviews.createImageRevision(
      "review-1",
      [{ imageAssetId: "image-1" }],
      "revision-1",
    );

    repositories.analysisRuns.create({
      id: "run-1",
      reviewId: "review-1",
      kind: "design",
      imageRevisionId: "revision-1",
      idempotencyKey: "design-submit-1",
      inputSnapshot: { context: null, images: [{ id: "image-1", digest: "sha256:abc" }] },
      passes: [
        { id: "pass-d1", key: "D1", position: 0 },
        { id: "pass-d3", key: "D3", position: 1 },
      ],
    });
    expect(() => repositories.reviews.markImagePurged("image-1")).toThrow(/active analysis run/i);
    const duplicate = repositories.analysisRuns.create({
      id: "ignored-run-id",
      reviewId: "review-1",
      kind: "design",
      imageRevisionId: "revision-1",
      idempotencyKey: "design-submit-1",
      inputSnapshot: { ignored: true },
      passes: [{ key: "D1", position: 0 }],
    });
    expect(duplicate.id).toBe("run-1");

    expect(repositories.analysisRuns.claimNextQueued("worker-1", 30_000)?.id).toBe("run-1");
    const firstAttempt = repositories.analysisRuns.beginPassAttempt("pass-d1", {
      id: "attempt-1",
      provider: "openai",
      model: "configured-model",
      imageDetail: "high",
      reasoningEffort: "medium",
      promptVersion: "d1.v1",
      schemaVersion: "d1.v1",
    });
    expect(firstAttempt.attemptNumber).toBe(1);
    repositories.analysisRuns.failPassAttempt("attempt-1", {
      failure: { code: "rate_limit", message: "The model service asked us to retry later." },
      durationMs: 123,
      apiStatusCode: 429,
    });
    repositories.analysisRuns.transitionRun("run-1", "failed", {
      code: "pass_failed",
      message: "D1 failed.",
    });

    const retried = repositories.analysisRuns.retryPass("pass-d1");
    expect(retried.state).toBe("queued");
    expect(retried.passes.map((pass) => [pass.passKey, pass.state])).toEqual([
      ["D1", "pending"],
      ["D3", "pending"],
    ]);

    repositories.analysisRuns.claimNextQueued("worker-1", 30_000);
    const secondAttempt = repositories.analysisRuns.beginPassAttempt("pass-d1", {
      id: "attempt-2",
      provider: "openai",
      model: "configured-model",
      promptVersion: "d1.v1",
      schemaVersion: "d1.v1",
    });
    expect(secondAttempt.attemptNumber).toBe(2);
    repositories.analysisRuns.completePassAttempt("attempt-2", {
      validatedOutput: { evidence: [] },
      durationMs: 88,
      apiRequestId: "request-safe-id",
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    });
    repositories.analysisRuns.skipPass("pass-d3");

    const detail = repositories.analysisRuns.getDetail("run-1");
    expect(detail?.passes[0]?.attempts.map((attempt) => attempt.state)).toEqual([
      "failed",
      "completed",
    ]);
    expect(detail?.passes[0]?.attempts[1]?.validatedOutput).toEqual({ evidence: [] });
    expect(detail?.passes[1]?.state).toBe("skipped");
    expect(() => repositories.analysisRuns.transitionPass("pass-d1", "running")).toThrow(
      InvalidStateTransitionError,
    );

    repositories.analysisRuns.create({
      id: "run-cancelled-before-start",
      reviewId: "review-1",
      kind: "design",
      imageRevisionId: "revision-1",
      inputSnapshot: { images: [{ id: "image-1" }] },
      passes: [{ id: "pass-never-started", key: "D1", position: 0 }],
    });
    const cancelled = repositories.analysisRuns.requestCancellation(
      "run-cancelled-before-start",
    );
    expect(cancelled.state).toBe("cancelled");
    expect(
      repositories.analysisRuns.getPass("pass-never-started")?.state,
    ).toBe("cancelled");
  });

  it("allocates artifact versions only while atomically finalising successful runs", () => {
    const repositories = createRepositories(handle.db);
    repositories.reviews.create({ id: "review-1" });
    repositories.reviews.createImageAsset({
      id: "image-1",
      reviewId: "review-1",
      contentDigest: "sha256:abc",
      mimeType: "image/webp",
      width: 200,
      height: 300,
      byteSize: 1_000,
    });
    repositories.reviews.createImageRevision(
      "review-1",
      [{ imageAssetId: "image-1" }],
      "revision-1",
    );

    for (const sequence of [1, 2]) {
      repositories.analysisRuns.create({
        id: `design-run-${sequence}`,
        reviewId: "review-1",
        kind: "design",
        imageRevisionId: "revision-1",
        inputSnapshot: {
          context: `context-${sequence}`,
          images: [{ id: "image-1", digest: "sha256:abc", order: 0 }],
          reviewAreas: [{ id: "hierarchy", mode: "focus", taxonomyVersion: "v1" }],
        },
        passes: [{ id: `design-pass-${sequence}`, key: "D1", position: 0 }],
      });
      repositories.analysisRuns.claimNextQueued("worker-1", 30_000);
      repositories.analysisRuns.beginPassAttempt(`design-pass-${sequence}`, {
        id: `design-attempt-${sequence}`,
        provider: "openai",
        model: "configured-model",
        promptVersion: "d1.v1",
        schemaVersion: "d1.v1",
      });
      repositories.analysisRuns.completePassAttempt(`design-attempt-${sequence}`, {
        validatedOutput: { evidence: [] },
        durationMs: 10,
      });
      const artifact = repositories.analysisArtifacts.finaliseDesignRun({
        id: `design-analysis-${sequence}`,
        runId: `design-run-${sequence}`,
        schemaVersion: "design.v1",
        promptSetVersion: "design-prompts.v1",
        passProvenance: [{ pass: "D1", attempt: sequence }],
        artifact: { evidence: [], findings: [], synthesis: { overallReading: "Test" } },
      });
      expect(artifact.version).toBe(sequence);
      expect(repositories.analysisRuns.requireById(`design-run-${sequence}`).state).toBe(
        "completed",
      );
    }

    const repeated = repositories.analysisArtifacts.finaliseDesignRun({
      runId: "design-run-2",
      schemaVersion: "ignored",
      promptSetVersion: "ignored",
      passProvenance: [],
      artifact: { ignored: true },
    });
    expect(repeated.id).toBe("design-analysis-2");
    expect(repositories.analysisArtifacts.listDesignAnalyses("review-1")).toHaveLength(2);

    expect(() =>
      handle.sqlite
        .prepare("update design_analyses set artifact_json = ? where id = ?")
        .run("{}", "design-analysis-1"),
    ).toThrow(/immutable/i);
  });

  it("prevents stale analysis enqueue and retry after review deletion begins", () => {
    const repositories = createRepositories(handle.db);
    repositories.reviews.create({ id: "review-deleting" });
    repositories.reviews.createImageAsset({
      id: "image-deleting",
      reviewId: "review-deleting",
      contentDigest: "sha256:deleting",
      mimeType: "image/png",
      width: 100,
      height: 100,
      byteSize: 100,
    });
    repositories.reviews.createImageRevision(
      "review-deleting",
      [{ imageAssetId: "image-deleting" }],
      "revision-deleting",
    );
    repositories.analysisRuns.create({
      id: "run-deleting",
      reviewId: "review-deleting",
      kind: "design",
      imageRevisionId: "revision-deleting",
      inputSnapshot: { images: [{ id: "image-deleting" }] },
      passes: [{ id: "pass-deleting", key: "D1", position: 0 }],
    });
    repositories.analysisRuns.claimNextQueued("worker", 10_000);
    repositories.analysisRuns.beginPassAttempt("pass-deleting", {
      id: "attempt-deleting",
      provider: "openai",
      model: "configured-model",
      promptVersion: "v1",
      schemaVersion: "v1",
    });
    repositories.analysisRuns.failPassAttempt("attempt-deleting", {
      failure: { code: "invalid_output", message: "The output was invalid." },
      durationMs: 1,
    });
    repositories.analysisRuns.transitionRun("run-deleting", "failed", {
      code: "pass_failed",
      message: "D1 failed.",
    });

    expect(repositories.reviews.beginDeletion("review-deleting").lifecycle).toBe("closed");
    expect(() => repositories.analysisRuns.retryPass("pass-deleting")).toThrow(
      /active review/i,
    );
    expect(() =>
      repositories.analysisRuns.create({
        id: "stale-enqueue",
        reviewId: "review-deleting",
        kind: "design",
        imageRevisionId: "revision-deleting",
        inputSnapshot: {},
        passes: [{ key: "D1", position: 0 }],
      }),
    ).toThrow(/active review/i);

    repositories.reviews.markImagePurgePending("image-deleting");
    repositories.reviews.markImagePurged("image-deleting");
    repositories.reviews.deleteReview("review-deleting");
    expect(repositories.reviews.getById("review-deleting")).toBeNull();
  });

  it("persists JSON settings, presets, and criteria artifacts linked to a design version", () => {
    const repositories = createRepositories(handle.db);
    repositories.settings.set("retention", { mode: "session", expiryHours: null });
    repositories.settings.createPreset({
      id: "preset-1",
      name: "Typography focus",
      taxonomyVersion: "v1",
      selections: [{ areaId: "typography", mode: "focus" }],
    });
    expect(repositories.settings.get("retention")).toEqual({
      mode: "session",
      expiryHours: null,
    });
    expect(repositories.settings.getPreset("preset-1")?.selections).toEqual([
      { areaId: "typography", mode: "focus" },
    ]);

    repositories.reviews.create({ id: "review-1" });
    repositories.reviews.createImageAsset({
      id: "image-1",
      reviewId: "review-1",
      contentDigest: "sha256:abc",
      mimeType: "image/png",
      width: 100,
      height: 100,
      byteSize: 100,
    });
    repositories.reviews.createImageRevision(
      "review-1",
      [{ imageAssetId: "image-1" }],
      "revision-1",
    );

    repositories.analysisRuns.create({
      id: "design-run",
      reviewId: "review-1",
      kind: "design",
      imageRevisionId: "revision-1",
      inputSnapshot: { context: "Original context" },
      passes: [{ id: "d1", key: "D1", position: 0 }],
    });
    repositories.analysisRuns.claimNextQueued("worker", 10_000);
    repositories.analysisRuns.beginPassAttempt("d1", {
      id: "d1-attempt",
      provider: "openai",
      model: "configured-model",
      promptVersion: "v1",
      schemaVersion: "v1",
    });
    repositories.analysisRuns.completePassAttempt("d1-attempt", {
      validatedOutput: {},
      durationMs: 1,
    });
    repositories.analysisArtifacts.finaliseDesignRun({
      id: "design-analysis",
      runId: "design-run",
      schemaVersion: "v1",
      promptSetVersion: "v1",
      passProvenance: [],
      artifact: { synthesis: "Design" },
    });

    repositories.analysisRuns.create({
      id: "criteria-run",
      reviewId: "review-1",
      kind: "criteria",
      imageRevisionId: "revision-1",
      selectedDesignAnalysisId: "design-analysis",
      inputSnapshot: { context: "Original context", selectedDesignAnalysisId: "design-analysis" },
      passes: [{ id: "c1", key: "C1", position: 0 }],
    });
    repositories.analysisRuns.claimNextQueued("worker", 10_000);
    repositories.analysisRuns.beginPassAttempt("c1", {
      id: "c1-attempt",
      provider: "openai",
      model: "configured-model",
      promptVersion: "v1",
      schemaVersion: "v1",
    });
    repositories.analysisRuns.completePassAttempt("c1-attempt", {
      validatedOutput: {},
      durationMs: 1,
    });
    const criteriaArtifact = repositories.analysisArtifacts.finaliseCriteriaRun({
      id: "criteria-analysis",
      runId: "criteria-run",
      schemaVersion: "v1",
      promptSetVersion: "v1",
      criteriaSnapshot: [
        { id: "criterion-1", statement: "Visible wording", judgementStatements: [] },
      ],
      passProvenance: [],
      artifact: { results: [], synthesis: "Criteria" },
    });

    expect(criteriaArtifact).toMatchObject({
      version: 1,
      designAnalysisId: "design-analysis",
      inputSnapshot: {
        context: "Original context",
        selectedDesignAnalysisId: "design-analysis",
      },
    });
    expect(criteriaArtifact.criteriaSnapshot).toEqual([
      { id: "criterion-1", statement: "Visible wording", judgementStatements: [] },
    ]);
    expect(() =>
      handle.sqlite
        .prepare("update criteria_analyses set artifact_json = ? where id = ?")
        .run("{}", "criteria-analysis"),
    ).toThrow(/immutable/i);

    repositories.reviews.markImagePurgePending("image-1");
    repositories.reviews.markImagePurged("image-1");
    repositories.reviews.beginDeletion("review-1");
    repositories.reviews.deleteReview("review-1");

    expect(repositories.reviews.getById("review-1")).toBeNull();
    expect(repositories.analysisRuns.listByReview("review-1")).toEqual([]);
    expect(repositories.analysisArtifacts.listDesignAnalyses("review-1")).toEqual([]);
    expect(repositories.analysisArtifacts.listCriteriaAnalyses("review-1")).toEqual([]);
    expect(repositories.settings.get("retention")).toEqual({
      mode: "session",
      expiryHours: null,
    });
    expect(repositories.settings.getPreset("preset-1")?.name).toBe("Typography focus");
  });
});
