import { describe, expect, it } from "vitest";

import taxonomyJson from "@/config/review-taxonomy.v1.json";
import {
  CriteriaAnalysisInputSnapshotSchema,
  CriteriaSnapshotSchema,
  DesignAnalysisInputSnapshotSchema,
  ImageManifestSchema,
  PassAttemptSchema,
  ReviewImageSchema,
  TaxonomyConfigSchema,
  applyCategoryMode,
  assertAnalysisPassTransition,
  assertAnalysisRunTransition,
  assertCriteriaSnapshotMatchesDesignSnapshot,
  canTransitionAnalysisPass,
  canTransitionAnalysisRun,
  parseImmutableDesignAnalysisInputSnapshot,
  validateSelectionsAgainstTaxonomy,
} from "@/lib/domain";

const NOW = "2026-08-15T02:00:00.000Z";
const DIGEST = "a".repeat(64);

const modelConfiguration = {
  provider: "openai" as const,
  model: "configured-model",
  imageDetail: "original" as const,
  reasoningEffort: "max" as const,
  store: false as const,
};

const limits = {
  maximumImages: 10,
  maximumBytesPerImage: 10_000_000,
  maximumPixelsPerImage: 30_000_000,
  maximumAggregateUploadBytes: 50_000_000,
  maximumContextCharacters: 20_000,
  maximumCriteria: 20,
  maximumJudgementStatementsPerCriterion: 10,
  maximumPassAttempts: 3,
  passTimeoutMs: 120_000,
  runTimeoutMs: 900_000,
  maximumOutputTokensPerPass: 8_000,
};

const image = {
  imageId: "image-1",
  order: 0,
  sanitizedDigest: DIGEST,
  mimeType: "image/png" as const,
  width: 1200,
  height: 800,
  byteSize: 50_000,
};

const reviewArea = {
  taxonomyId: "visual-communication-design",
  taxonomyVersion: "1.0.0",
  areaId: "typography.hierarchy",
  areaLabel: "Typographic hierarchy",
  mode: "focus" as const,
};

const passConfigurations = (passIds: readonly string[]) =>
  passIds.map((passId) => ({
    passId,
    modelConfiguration,
    promptVersion: "1.0.0",
    schemaVersion: "1.0.0",
  }));

const designSnapshot = {
  kind: "design" as const,
  reviewId: "review-1",
  imageRevisionId: "revision-1",
  context: "A poster intended for a public event.",
  images: [image],
  reviewAreas: [reviewArea],
  passConfigurations: passConfigurations(["D1", "D2", "D3", "D4", "D5", "D6"]),
  operationalLimits: limits,
  capturedAt: NOW,
};

const criterion = {
  id: "criterion-1",
  title: "Hierarchy",
  statement: "Uses hierarchy to guide the reader.",
  assessorNote: "Attend to the call to action.",
  judgementStatements: [
    {
      id: "statement-1",
      label: "Demonstrated",
      description: "The information order is immediately clear.",
      order: 0,
    },
    {
      id: "statement-2",
      label: "Partly demonstrated",
      description: "The information order is present but inconsistent.",
      order: 1,
    },
  ],
  order: 0,
};

const criteriaSnapshot = {
  kind: "criteria" as const,
  reviewId: "review-1",
  imageRevisionId: "revision-1",
  designAnalysisId: "design-analysis-1",
  designAnalysisVersion: 1,
  context: designSnapshot.context,
  images: [image],
  reviewAreas: [reviewArea],
  criteria: [criterion],
  passConfigurations: passConfigurations(["C1", "C2", "C3", "C4", "C5"]),
  operationalLimits: limits,
  capturedAt: NOW,
};

describe("default taxonomy", () => {
  it("is a valid, versioned taxonomy with stable unique areas", () => {
    const taxonomy = TaxonomyConfigSchema.parse(taxonomyJson);
    expect(taxonomy.version).toBe("1.0.0");
    expect(taxonomy.areas).toHaveLength(58);
    expect(new Set(taxonomy.areas.map(({ id }) => id)).size).toBe(58);
  });

  it("validates a complete selection and applies a parent category mode", () => {
    const taxonomy = TaxonomyConfigSchema.parse(taxonomyJson);
    const selections = taxonomy.areas.map(({ id: areaId }) => ({ areaId, mode: "off" as const }));
    expect(validateSelectionsAgainstTaxonomy(taxonomy, selections)).toHaveLength(58);

    const focused = applyCategoryMode(
      taxonomy,
      selections,
      "applied-visual-communication",
      "focus",
    );
    expect(focused.filter(({ mode }) => mode === "focus")).toHaveLength(39);
    expect(focused.find(({ areaId }) => areaId === "elements.line")?.mode).toBe("off");
  });

  it("rejects category cycles and incomplete selections", () => {
    const invalid = structuredClone(taxonomyJson);
    invalid.categories[0]!.parentId = "elements-of-design";
    expect(TaxonomyConfigSchema.safeParse(invalid).success).toBe(false);

    const taxonomy = TaxonomyConfigSchema.parse(taxonomyJson);
    expect(() => validateSelectionsAgainstTaxonomy(taxonomy, [])).toThrow(
      "Missing review-area selection",
    );
  });
});

describe("review and criterion contracts", () => {
  it("requires ordered criteria and ordered custom judgement statements", () => {
    expect(CriteriaSnapshotSchema.parse([criterion])).toHaveLength(1);
    expect(
      CriteriaSnapshotSchema.safeParse([
        { ...criterion, judgementStatements: [{ ...criterion.judgementStatements[0], order: 1 }] },
      ]).success,
    ).toBe(false);
  });

  it("rejects unknown fields instead of silently stripping them", () => {
    expect(ImageManifestSchema.parse([image])[0]?.analysisRole).toBe("final_work");
    expect(
      ImageManifestSchema.safeParse([{ ...image, temporaryPath: "/private/upload.png" }]).success,
    ).toBe(false);
  });

  it("enforces purge-state consistency", () => {
    const purgedImage = {
      id: "image-1",
      displayName: "Poster",
      mimeType: "image/png",
      width: 1200,
      height: 800,
      byteSize: 50_000,
      sanitizedDigest: DIGEST,
      order: 0,
      state: "purged",
      retainedLocally: false,
      createdAt: NOW,
    };
    expect(ReviewImageSchema.safeParse(purgedImage).success).toBe(false);
    expect(ReviewImageSchema.safeParse({ ...purgedImage, purgedAt: NOW }).success).toBe(true);
  });
});

describe("immutable input snapshots", () => {
  it("requires the exact pass set and returns a deeply frozen snapshot", () => {
    expect(DesignAnalysisInputSnapshotSchema.parse(designSnapshot).kind).toBe("design");
    expect(
      DesignAnalysisInputSnapshotSchema.safeParse({
        ...designSnapshot,
        passConfigurations: passConfigurations(["D1", "D2", "D3", "D4", "D5", "C1"]),
      }).success,
    ).toBe(false);

    const immutable = parseImmutableDesignAnalysisInputSnapshot(designSnapshot);
    expect(Object.isFrozen(immutable)).toBe(true);
    expect(Object.isFrozen(immutable.images)).toBe(true);
    expect(Object.isFrozen(immutable.images[0])).toBe(true);
    expect(
      DesignAnalysisInputSnapshotSchema.safeParse({
        ...designSnapshot,
        images: [{ ...image, analysisRole: "concept_development" }],
      }).success,
    ).toBe(false);
  });

  it("locks Criteria Analysis to the selected Design Analysis inputs", () => {
    expect(CriteriaAnalysisInputSnapshotSchema.parse(criteriaSnapshot).kind).toBe("criteria");
    expect(() => assertCriteriaSnapshotMatchesDesignSnapshot(criteriaSnapshot, designSnapshot)).not.toThrow();
    expect(() =>
      assertCriteriaSnapshotMatchesDesignSnapshot(
        { ...criteriaSnapshot, context: "A later edit." },
        designSnapshot,
      ),
    ).toThrow("context snapshot");
  });
});

describe("durable analysis state", () => {
  it("exposes explicit restart transitions while keeping completed work terminal", () => {
    expect(canTransitionAnalysisRun("queued", "running")).toBe(true);
    expect(canTransitionAnalysisRun("failed", "queued")).toBe(true);
    expect(canTransitionAnalysisRun("completed", "running")).toBe(false);
    expect(canTransitionAnalysisPass("pending", "skipped")).toBe(true);
    expect(canTransitionAnalysisPass("interrupted", "pending")).toBe(true);
    expect(() => assertAnalysisRunTransition("completed", "running")).toThrow(
      "completed -> running",
    );
    expect(() => assertAnalysisPassTransition("skipped", "running")).toThrow(
      "skipped -> running",
    );
  });

  it("requires validated output only on completed pass attempts", () => {
    const baseAttempt = {
      id: "attempt-1",
      analysisPassRecordId: "pass-record-1",
      passId: "D1",
      attemptNumber: 1,
      configuration: passConfigurations(["D1"])[0],
      startedAt: NOW,
    };
    expect(PassAttemptSchema.safeParse({ ...baseAttempt, state: "running" }).success).toBe(true);
    expect(
      PassAttemptSchema.safeParse({
        ...baseAttempt,
        state: "completed",
        finishedAt: NOW,
        durationMs: 10,
      }).success,
    ).toBe(false);
    expect(
      PassAttemptSchema.safeParse({
        ...baseAttempt,
        state: "completed",
        finishedAt: NOW,
        durationMs: 10,
        validatedOutput: { observations: [] },
      }).success,
    ).toBe(true);
  });
});
