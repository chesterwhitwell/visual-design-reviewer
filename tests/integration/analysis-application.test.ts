import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import {
  analysisRunDto,
  enqueueCriteriaAnalysis,
  enqueueDesignAnalysis,
  parseDesignAnalysisRow,
  parseRunSnapshot,
} from "@/lib/application/analysis";
import { resetRuntimeConfigForTests } from "@/lib/config/runtime";
import {
  closeDatabase,
  createRepositories,
  getDatabaseHandle,
  type AnalysisRunDetail,
  type Repositories,
} from "@/lib/db";
import type {
  AnalysisPassId,
  DesignAnalysisInputSnapshot,
  PassProvenanceSchema,
} from "@/lib/domain";
import { AppError } from "@/lib/http/errors";

const managedEnvironment = [
  "NODE_ENV",
  "DATABASE_PATH",
  "OPENAI_API_KEY",
  "OPENAI_VISION_MODEL",
  "OPENAI_SYNTHESIS_MODEL",
  "ANALYSIS_GATEWAY",
  "MODEL_SCHEMA_RETRIES",
] as const;

describe("analysis application snapshots", () => {
  let directory: string;
  let repositories: Repositories;
  let previousEnvironment: Partial<Record<(typeof managedEnvironment)[number], string>>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "design-review-analysis-app-"));
    previousEnvironment = Object.fromEntries(
      managedEnvironment.flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
    );
    closeDatabase();
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_PATH: join(directory, "test.sqlite"),
      OPENAI_API_KEY: "test-server-key",
      OPENAI_VISION_MODEL: "vision-model",
      OPENAI_SYNTHESIS_MODEL: "synthesis-model",
      ANALYSIS_GATEWAY: "openai",
      MODEL_SCHEMA_RETRIES: "1",
    });
    resetRuntimeConfigForTests();
    repositories = createRepositories();
  });

  afterEach(() => {
    closeDatabase();
    resetRuntimeConfigForTests();
    for (const key of managedEnvironment) {
      const previous = previousEnvironment[key];
      if (previous === undefined) Reflect.deleteProperty(process.env, key);
      else Object.assign(process.env, { [key]: previous });
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it("rejects runs without an image or a selected review area", () => {
    repositories.reviews.create({ id: "review-1" });
    repositories.reviews.replaceReviewAreaSelections("review-1", [areaSelection("focus")]);

    expectAppError(() => enqueueDesignAnalysis("review-1"), "analysis_not_ready");

    addImageRevision(repositories, "review-1", "image-1", "revision-1", "a");
    repositories.reviews.replaceReviewAreaSelections("review-1", [areaSelection("off")]);
    expectAppError(() => enqueueDesignAnalysis("review-1"), "analysis_not_ready");
  });

  it("requires final work and captures development roles in the immutable snapshot", () => {
    repositories.reviews.create({ id: "review-1" });
    addImageRevision(
      repositories,
      "review-1",
      "image-1",
      "revision-1",
      "a",
      "concept_development",
    );
    repositories.reviews.replaceReviewAreaSelections("review-1", [areaSelection("focus")]);
    expectAppError(() => enqueueDesignAnalysis("review-1"), "analysis_not_ready");

    repositories.reviews.createImageAsset({
      id: "image-2",
      reviewId: "review-1",
      displayName: "image-2.png",
      contentDigest: "b".repeat(64),
      mimeType: "image/png",
      width: 1200,
      height: 800,
      byteSize: 50_000,
    });
    repositories.reviews.createImageRevision(
      "review-1",
      [
        { imageAssetId: "image-1", analysisRole: "concept_development" },
        { imageAssetId: "image-2", analysisRole: "final_work" },
      ],
      "revision-2",
    );
    const snapshot = parseRunSnapshot(enqueueDesignAnalysis("review-1"));
    expect(snapshot.images.map(({ analysisRole }) => analysisRole)).toEqual([
      "concept_development",
      "final_work",
    ]);
  });

  it("captures an immutable design-run snapshot independent of later review edits", () => {
    repositories.reviews.create({
      id: "review-1",
      title: "Poster review",
      context: "Original audience and purpose.",
    });
    addImageRevision(repositories, "review-1", "image-1", "revision-1", "a");
    repositories.reviews.replaceReviewAreaSelections("review-1", [areaSelection("focus")]);

    const created = enqueueDesignAnalysis("review-1", {
      idempotencyKey: "  stable-submit-key  ",
    });
    const original = parseRunSnapshot(created);
    expect(original).toMatchObject({
      kind: "design",
      reviewId: "review-1",
      imageRevisionId: "revision-1",
      context: "Original audience and purpose.",
      images: [{
        imageId: "image-1",
        sanitizedDigest: "a".repeat(64),
        analysisRole: "final_work",
      }],
      reviewAreas: [{ areaId: "typography.hierarchy", mode: "focus" }],
    });
    expect(original.passConfigurations.map(({ passId }) => passId)).toEqual([
      "D1",
      "D2",
      "D3",
      "D4",
      "D5",
      "D6",
    ]);
    expect(
      original.passConfigurations.every(
        ({ modelConfiguration }) => modelConfiguration.store === false,
      ),
    ).toBe(true);
    expect(original.operationalLimits.maximumPassAttempts).toBe(2);

    repositories.reviews.update("review-1", { context: "A later, unrelated edit." });
    addImageRevision(repositories, "review-1", "image-2", "revision-2", "b");
    repositories.reviews.replaceReviewAreaSelections("review-1", [
      {
        areaId: "colour.contrast",
        taxonomyVersion: "1.0.0",
        areaLabel: "Contrast",
        mode: "review",
        position: 0,
      },
    ]);

    const persisted = parseRunSnapshot(repositories.analysisRuns.requireById(created.id));
    expect(persisted).toEqual(original);
    expect(persisted.imageRevisionId).not.toBe("revision-2");
    expect(repositories.analysisRuns.requireById(created.id).idempotencyKey).toBe(
      "stable-submit-key",
    );
    expect(() =>
      getDatabaseHandle().sqlite
        .prepare("update analysis_runs set input_snapshot_json = ? where id = ?")
        .run(JSON.stringify({ replaced: true }), created.id),
    ).toThrow(/immutable/i);
    expect(() =>
      getDatabaseHandle().sqlite
        .prepare("update analysis_runs set image_revision_id = ? where id = ?")
        .run("revision-2", created.id),
    ).toThrow(/immutable/i);
  });

  it("binds Criteria Analysis to the selected Design Analysis inputs and current rubric", () => {
    repositories.reviews.create({ id: "review-1", context: null });
    addImageRevision(repositories, "review-1", "image-1", "revision-1", "a");
    repositories.reviews.replaceReviewAreaSelections("review-1", [areaSelection("focus")]);

    const designRun = enqueueDesignAnalysis("review-1");
    const designSnapshot = parseRunSnapshot(designRun);
    expect(designSnapshot.kind).toBe("design");
    const designAnalysis = completeDesignAnalysis(
      repositories,
      designRun,
      designSnapshot as DesignAnalysisInputSnapshot,
    );

    repositories.reviews.update("review-1", { context: "This was added after design analysis." });
    addImageRevision(repositories, "review-1", "image-2", "revision-2", "b");
    repositories.reviews.replaceReviewAreaSelections("review-1", [
      {
        areaId: "colour.contrast",
        taxonomyVersion: "1.0.0",
        areaLabel: "Contrast",
        mode: "review",
        position: 0,
      },
    ]);
    repositories.reviews.replaceCriteria("review-1", [
      {
        id: "criterion-1",
        title: "Hierarchy",
        statement: "Uses hierarchy to guide the reader.",
        assessorNote: "Prioritise the call to action.",
        position: 0,
        judgementStatements: [
          {
            id: "statement-1",
            label: "Demonstrated",
            description: "The intended reading order is immediately clear.",
            position: 0,
          },
        ],
      },
    ]);

    const criteriaRun = enqueueCriteriaAnalysis("review-1", designAnalysis.id);
    const criteriaSnapshot = parseRunSnapshot(criteriaRun);
    expect(criteriaSnapshot).toMatchObject({
      kind: "criteria",
      designAnalysisId: designAnalysis.id,
      designAnalysisVersion: 1,
      imageRevisionId: "revision-1",
      context: null,
      images: [{
        imageId: "image-1",
        sanitizedDigest: "a".repeat(64),
        analysisRole: "final_work",
      }],
      reviewAreas: [{ areaId: "typography.hierarchy", mode: "focus" }],
      criteria: [
        {
          id: "criterion-1",
          title: "Hierarchy",
          assessorNote: "Prioritise the call to action.",
          judgementStatements: [{ id: "statement-1", label: "Demonstrated" }],
        },
      ],
    });
    expect(criteriaSnapshot.imageRevisionId).not.toBe("revision-2");
    expect(criteriaSnapshot.reviewAreas).not.toContainEqual(
      expect.objectContaining({ areaId: "colour.contrast" }),
    );

    repositories.reviews.replaceCriteria("review-1", [
      {
        id: "criterion-2",
        title: "Changed later",
        statement: "This edit must not rewrite the queued run.",
        position: 0,
      },
    ]);
    expect(
      parseRunSnapshot(repositories.analysisRuns.requireById(criteriaRun.id)),
    ).toEqual(criteriaSnapshot);
  });

  it("returns a deliberately narrow run DTO with safe retry metadata", () => {
    repositories.reviews.create({ id: "review-1" });
    addImageRevision(repositories, "review-1", "image-1", "revision-1", "a");
    repositories.analysisRuns.create({
      id: "run-1",
      reviewId: "review-1",
      kind: "design",
      imageRevisionId: "revision-1",
      inputSnapshot: {
        privateBrief: "must not be serialised by the status endpoint",
      },
      passes: [{ id: "pass-1", key: "D1", position: 0 }],
    });
    repositories.analysisRuns.claimNextQueued("worker-private-id", 30_000);
    repositories.analysisRuns.transitionRun("run-1", "failed", {
      code: "rate_limit",
      message: "The service asked us to retry later.",
    });

    const dto = analysisRunDto(
      repositories.analysisRuns.getDetail("run-1") as AnalysisRunDetail,
    );
    expect(dto.error).toEqual({
      code: "rate_limit",
      message: "The service asked us to retry later.",
      retryable: true,
    });
    expect(dto).not.toHaveProperty("inputSnapshot");
    expect(dto).not.toHaveProperty("leaseOwner");
    expect(JSON.stringify(dto)).not.toContain("privateBrief");
    expect(JSON.stringify(dto)).not.toContain("worker-private-id");
  });
});

function areaSelection(mode: "off" | "review" | "focus") {
  return {
    areaId: "typography.hierarchy",
    taxonomyVersion: "1.0.0",
    areaLabel: "Typographic hierarchy",
    mode,
    position: 0,
  };
}

function addImageRevision(
  repositories: Repositories,
  reviewId: string,
  imageId: string,
  revisionId: string,
  digestCharacter: string,
  analysisRole: "final_work" | "concept_development" = "final_work",
) {
  repositories.reviews.createImageAsset({
    id: imageId,
    reviewId,
    displayName: `${imageId}.png`,
    contentDigest: digestCharacter.repeat(64),
    mimeType: "image/png",
    width: 1200,
    height: 800,
    byteSize: 50_000,
  });
  return repositories.reviews.createImageRevision(
    reviewId,
    [{ imageAssetId: imageId, analysisRole }],
    revisionId,
  );
}

function completeDesignAnalysis(
  repositories: Repositories,
  run: AnalysisRunDetail,
  snapshot: DesignAnalysisInputSnapshot,
) {
  expect(repositories.analysisRuns.claimNextQueued("test-worker", 30_000)?.id).toBe(run.id);
  const provenance: Array<z.infer<typeof PassProvenanceSchema>> = [];

  for (const pass of run.passes) {
    const passId = pass.passKey as AnalysisPassId;
    const configuration = snapshot.passConfigurations.find(
      (candidate) => candidate.passId === passId,
    )!;
    if (passId === "D3") {
      const skipped = repositories.analysisRuns.skipPass(pass.id);
      provenance.push({
        passId,
        state: "skipped",
        promptVersion: configuration.promptVersion,
        schemaVersion: configuration.schemaVersion,
        completedAt: skipped.completedAt!,
      });
      continue;
    }

    const attempt = repositories.analysisRuns.beginPassAttempt(pass.id, {
      id: `attempt-${passId.toLowerCase()}`,
      provider: configuration.modelConfiguration.provider,
      model: configuration.modelConfiguration.model,
      imageDetail: configuration.modelConfiguration.imageDetail,
      reasoningEffort: configuration.modelConfiguration.reasoningEffort,
      promptVersion: configuration.promptVersion,
      schemaVersion: configuration.schemaVersion,
    });
    const completed = repositories.analysisRuns.completePassAttempt(attempt.id, {
      validatedOutput: {},
      durationMs: 1,
    });
    provenance.push({
      passId,
      state: "completed",
      attemptId: completed.id,
      attemptNumber: completed.attemptNumber,
      modelConfiguration: configuration.modelConfiguration,
      promptVersion: configuration.promptVersion,
      schemaVersion: configuration.schemaVersion,
      durationMs: completed.durationMs!,
      completedAt: completed.completedAt!,
    });
  }

  return parseDesignAnalysisRow(
    repositories.analysisArtifacts.finaliseDesignRun({
      id: "design-analysis-1",
      runId: run.id,
      schemaVersion: "analysis.v2",
      promptSetVersion: "2026-08-15.v1",
      passProvenance: provenance,
      artifact: {
        evidence: [],
        findings: [],
        synthesis: {
          overallReading: {
            text: "No material finding was established from the test fixture.",
            sourceFindingIds: [],
          },
          strengths: [],
          developmentPriorities: [],
          majorReviewAreas: {
            elementsOfDesign: { strengths: [], areasForImprovement: [] },
            principlesOfDesign: { strengths: [], areasForImprovement: [] },
            appliedVisualCommunication: { strengths: [], areasForImprovement: [] },
          },
          focusAreaFeedback: [],
          nextSteps: [],
        },
      },
    }),
  );
}

function expectAppError(operation: () => unknown, code: AppError["code"]): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`Expected AppError ${code}`);
}
