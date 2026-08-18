import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  CriteriaSnapshotSchema,
  ReviewAreaSelectionsSchema,
  validateSelectionsAgainstTaxonomy,
  type Criterion,
  type ReviewAreaSelection,
  type TaxonomyCategory,
} from "@/lib/domain";
import { createRepositories } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { getTaxonomyConfig } from "@/lib/taxonomy";

const updateReviewSchema = z
  .object({
    title: z.string().trim().max(240).nullable().optional(),
    context: z.string().trim().max(20_000).nullable().optional(),
  })
  .strict();

const editableJudgementSchema = z
  .object({
    id: z.string().trim().min(1).max(128).optional(),
    label: z.string().trim().min(1).max(240),
    description: z.string().trim().min(1).max(4_000),
  })
  .strict();

const editableCriterionSchema = z
  .object({
    id: z.string().trim().min(1).max(128).optional(),
    title: z.string().trim().min(1).max(240),
    statement: z.string().trim().min(1).max(4_000),
    assessorNote: z.string().trim().max(4_000).nullable().optional(),
    judgementStatements: z.array(editableJudgementSchema).max(20),
  })
  .strict();

export function createReview(input: unknown) {
  const values = updateReviewSchema.parse(input);
  const repositories = createRepositories();
  const taxonomy = getTaxonomyConfig();
  const review = repositories.reviews.create({
    title: normaliseOptional(values.title),
    context: normaliseOptional(values.context),
  });
  repositories.reviews.replaceReviewAreaSelections(
    review.id,
    taxonomy.areas.map((area, position) => ({
      areaId: area.id,
      taxonomyVersion: taxonomy.version,
      areaLabel: area.label,
      mode: "review" as const,
      position,
    })),
  );
  return review;
}

export function updateReview(reviewId: string, input: unknown) {
  const values = updateReviewSchema.parse(input);
  if (!Object.hasOwn(values, "title") && !Object.hasOwn(values, "context")) {
    throw new AppError("bad_request", "No review fields were supplied.");
  }
  return createRepositories().reviews.update(reviewId, {
    ...(Object.hasOwn(values, "title") ? { title: normaliseOptional(values.title) } : {}),
    ...(Object.hasOwn(values, "context")
      ? { context: normaliseOptional(values.context) }
      : {}),
  });
}

export function listReviewSummaries() {
  const repositories = createRepositories();
  const reviews = repositories.reviews.list();
  const usageByReviewId = new Map(
    repositories.analysisRuns
      .listUsageByReviewIds(reviews.map(({ id }) => id))
      .map((usage) => [usage.reviewId, usage]),
  );
  return reviews.map((review) => {
    const revision = repositories.reviews.getLatestImageRevision(review.id);
    const designAnalyses = repositories.analysisArtifacts.listDesignAnalyses(review.id);
    const criteriaAnalyses = repositories.analysisArtifacts.listCriteriaAnalyses(review.id);
    return {
      id: review.id,
      title: review.title,
      contextPreview: review.context ? truncate(review.context, 170) : null,
      imageCount: revision?.images.length ?? 0,
      designAnalysisCount: designAnalyses.length,
      criteriaAnalysisCount: criteriaAnalyses.length,
      analysisUsage: usageDto(usageByReviewId.get(review.id)),
      updatedAt: review.updatedAt,
    };
  });
}

export function getReviewDetail(reviewId: string) {
  const repositories = createRepositories();
  const aggregate = repositories.reviews.getAggregate(reviewId);
  if (!aggregate) throw new AppError("not_found", "The review was not found.");
  const designAnalyses = repositories.analysisArtifacts.listDesignAnalyses(reviewId);
  const criteriaAnalyses = repositories.analysisArtifacts.listCriteriaAnalyses(reviewId);
  const runs = repositories.analysisRuns
    .listByReview(reviewId)
    .map((run) => repositories.analysisRuns.getDetail(run.id))
    .filter((run) => run !== null);
  const taxonomy = getTaxonomyConfig();

  return {
    id: aggregate.review.id,
    title: aggregate.review.title,
    context: aggregate.review.context,
    lifecycle: aggregate.review.lifecycle,
    createdAt: aggregate.review.createdAt,
    updatedAt: aggregate.review.updatedAt,
    analysisUsage: usageDto(repositories.analysisRuns.getUsageByReview(reviewId)),
    images:
      aggregate.imageRevision?.images.map(({ asset, position, imageLabel, analysisRole }) => ({
        id: asset.id,
        originalFilename: asset.displayName ?? imageLabel,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        byteSize: asset.byteSize,
        order: position,
        analysisRole,
        retainedLocally: asset.retentionState === "retained",
        state:
          asset.retentionState === "retained"
            ? ("available" as const)
            : asset.retentionState,
        retentionState: asset.retentionState,
        expiresAt: asset.expiresAt,
        previewUrl:
          asset.retentionState === "retained"
            ? `/api/reviews/${reviewId}/images/${asset.id}/preview`
            : null,
      })) ?? [],
    imageRevisionId: aggregate.imageRevision?.id ?? null,
    taxonomy: taxonomyDto(taxonomy.categories, taxonomy.areas, taxonomy.id, taxonomy.version, taxonomy.label),
    reviewAreas: aggregate.reviewAreas.map(({ areaId, mode }) => ({ areaId, mode })),
    criteria: aggregate.criteria.map((criterion) => ({
      id: criterion.id,
      title: criterion.title,
      statement: criterion.statement,
      assessorNote: criterion.assessorNote,
      order: criterion.position,
      judgementStatements: criterion.judgementStatements.map((statement) => ({
        id: statement.id,
        label: statement.label,
        description: statement.description,
        order: statement.position,
      })),
    })),
    designAnalyses: designAnalyses.map(flattenArtifact),
    criteriaAnalyses: criteriaAnalyses.map(flattenArtifact),
    runs: runs.map((run) => ({
      id: run.id,
      kind: run.kind,
      state: run.state,
      cancelRequested: run.cancelRequested,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      error:
        run.safeErrorCode && run.safeErrorMessage
          ? { code: run.safeErrorCode, message: run.safeErrorMessage }
          : null,
      passes: run.passes.map((pass) => ({
        id: pass.id,
        passId: pass.passKey,
        state: pass.state,
        position: pass.position,
        startedAt: pass.startedAt,
        completedAt: pass.completedAt,
        error:
          pass.safeErrorCode && pass.safeErrorMessage
            ? { code: pass.safeErrorCode, message: pass.safeErrorMessage }
            : null,
        attempts: pass.attempts.map((attempt) => ({
          id: attempt.id,
          attemptNumber: attempt.attemptNumber,
          state: attempt.state,
          model: attempt.model,
          promptVersion: attempt.promptVersion,
          schemaVersion: attempt.schemaVersion,
          durationMs: attempt.durationMs,
          inputTokens: attempt.inputTokens,
          outputTokens: attempt.outputTokens,
        })),
      })),
    })),
  };
}

function usageDto(
  usage:
    | {
        totalTokens: number;
        estimatedCostMicroUsd: number;
        meteredAttempts: number;
        unpricedAttempts: number;
      }
    | undefined,
) {
  return {
    totalTokens: usage?.totalTokens ?? 0,
    estimatedCostMicroUsd: usage?.estimatedCostMicroUsd ?? 0,
    meteredAttempts: usage?.meteredAttempts ?? 0,
    unpricedAttempts: usage?.unpricedAttempts ?? 0,
  };
}

export function saveReviewAreas(reviewId: string, input: unknown) {
  const body = z.object({ reviewAreas: ReviewAreaSelectionsSchema }).strict().parse(input);
  const taxonomy = getTaxonomyConfig();
  const selections = validateSelectionsAgainstTaxonomy(taxonomy, body.reviewAreas);
  return createRepositories().reviews.replaceReviewAreaSelections(
    reviewId,
    selections.map((selection, position) => {
      const area = taxonomy.areas.find(({ id }) => id === selection.areaId);
      if (!area) throw new AppError("bad_request", `Unknown review area ${selection.areaId}.`);
      return {
        areaId: area.id,
        taxonomyVersion: taxonomy.version,
        areaLabel: area.label,
        mode: selection.mode,
        position,
      };
    }),
  );
}

export function saveCriteria(reviewId: string, input: unknown): Criterion[] {
  const body = z.object({ criteria: z.array(editableCriterionSchema).max(50) }).strict().parse(input);
  const criteria = body.criteria.map((criterion, order) => ({
    id: criterion.id ?? randomUUID(),
    title: criterion.title,
    statement: criterion.statement,
    ...(normaliseOptional(criterion.assessorNote)
      ? { assessorNote: normaliseOptional(criterion.assessorNote) }
      : {}),
    order,
    judgementStatements: criterion.judgementStatements.map((statement, statementOrder) => ({
      id: statement.id ?? randomUUID(),
      label: statement.label,
      description: statement.description,
      order: statementOrder,
    })),
  }));
  if (criteria.length > 0) CriteriaSnapshotSchema.parse(criteria);

  const stored = createRepositories().reviews.replaceCriteria(
    reviewId,
    criteria.map((criterion) => ({
      id: criterion.id,
      title: criterion.title,
      statement: criterion.statement,
      assessorNote: criterion.assessorNote ?? null,
      position: criterion.order,
      judgementStatements: criterion.judgementStatements.map((statement) => ({
        id: statement.id,
        label: statement.label,
        description: statement.description,
        position: statement.order,
      })),
    })),
  );

  return stored.map((criterion) => ({
    id: criterion.id,
    title: criterion.title,
    statement: criterion.statement,
    ...(criterion.assessorNote ? { assessorNote: criterion.assessorNote } : {}),
    order: criterion.position,
    judgementStatements: criterion.judgementStatements.map((statement) => ({
      id: statement.id,
      label: statement.label,
      description: statement.description,
      order: statement.position,
    })),
  }));
}

export function getCurrentReviewAreas(reviewId: string): ReviewAreaSelection[] {
  return createRepositories().reviews
    .listReviewAreaSelections(reviewId)
    .map(({ areaId, mode }) => ({ areaId, mode }));
}

function flattenArtifact(row: {
  id: string;
  version: number;
  createdAt: string;
  inputSnapshot: unknown;
  passProvenance: unknown;
  artifact: unknown;
  [key: string]: unknown;
}) {
  const artifact =
    row.artifact && typeof row.artifact === "object" && !Array.isArray(row.artifact)
      ? (row.artifact as Record<string, unknown>)
      : { result: row.artifact };
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt,
    inputSnapshot: row.inputSnapshot,
    passProvenance: row.passProvenance,
    ...(typeof row.designAnalysisId === "string"
      ? { designAnalysisId: row.designAnalysisId }
      : {}),
    ...artifact,
  };
}

function taxonomyDto(
  categories: TaxonomyCategory[],
  areas: Array<{ id: string; categoryId: string; label: string; order: number }>,
  id: string,
  version: string,
  label: string,
) {
  const build = (parentId: string | null): unknown[] =>
    categories
      .filter((category) => category.parentId === parentId)
      .sort((left, right) => left.order - right.order)
      .map((category) => ({
        id: category.id,
        label: category.label,
        parentId: category.parentId,
        order: category.order,
        areas: areas
          .filter((area) => area.categoryId === category.id)
          .sort((left, right) => left.order - right.order)
          .map((area) => ({ id: area.id, label: area.label })),
        categories: build(category.id),
      }));
  return { id, version, label, categories: build(null), areas };
}

function normaliseOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1).trimEnd()}…`;
}
