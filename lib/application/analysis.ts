import "server-only";

import {
  AnalysisInputSnapshotSchema,
  CriteriaAnalysisInputSnapshotSchema,
  CriteriaAnalysisSchema,
  CriteriaSnapshotSchema,
  DesignAnalysisInputSnapshotSchema,
  DesignAnalysisSchema,
  PassProvenanceSchema,
  assertCriteriaSnapshotMatchesDesignSnapshot,
  type AnalysisPassId,
  type CriteriaAnalysis,
  type CriteriaAnalysisInputSnapshot,
  type DesignAnalysis,
  type DesignAnalysisInputSnapshot,
  type PassConfigurationSnapshot,
} from "@/lib/domain";
import {
  createRepositories,
  type AnalysisRunDetail,
  type AnalysisRunRow,
  type CriteriaAnalysisRow,
  type DesignAnalysisRow,
} from "@/lib/db";
import { getRuntimeConfig, type RuntimeConfig } from "@/lib/config/runtime";
import {
  PASS_SCHEMA_VERSION as CURRENT_PASS_SCHEMA_VERSION,
  getPromptDefinition,
} from "@/lib/analysis/prompts";
import { AppError } from "@/lib/http/errors";
import { getTaxonomyConfig } from "@/lib/taxonomy";

export const DESIGN_PASS_IDS = ["D1", "D2", "D3", "D4", "D5", "D6"] as const;
export const CRITERIA_PASS_IDS = ["C1", "C2", "C3", "C4", "C5"] as const;
export const ANALYSIS_SCHEMA_VERSION = "analysis.v2";
export const PASS_SCHEMA_VERSION = CURRENT_PASS_SCHEMA_VERSION;

type EnqueueOptions = {
  idempotencyKey?: string | null;
};

export function enqueueDesignAnalysis(
  reviewId: string,
  options: EnqueueOptions = {},
): AnalysisRunDetail {
  const repositories = createRepositories();
  const aggregate = repositories.reviews.getAggregate(reviewId);
  if (!aggregate) {
    throw new AppError("not_found", "The review was not found.");
  }
  if (aggregate.review.lifecycle !== "active") {
    throw new AppError("conflict", "A closed review cannot start another analysis.");
  }
  if (!aggregate.imageRevision || aggregate.imageRevision.images.length === 0) {
    throw new AppError("analysis_not_ready", "Upload at least one image before running analysis.");
  }
  if (!aggregate.imageRevision.images.some(({ analysisRole }) => analysisRole === "final_work")) {
    throw new AppError(
      "analysis_not_ready",
      "Tag at least one image as Final work before running Design Analysis.",
    );
  }

  const config = requireLiveAnalysisConfiguration();
  const taxonomy = getTaxonomyConfig();
  const reviewAreas = aggregate.reviewAreas
    .filter(({ mode }) => mode !== "off")
    .sort((left, right) => left.position - right.position)
    .map(({ areaId, areaLabel, mode, taxonomyVersion }) => ({
      taxonomyId: taxonomy.id,
      taxonomyVersion,
      areaId,
      areaLabel,
      mode,
    }));
  if (reviewAreas.length === 0) {
    throw new AppError(
      "analysis_not_ready",
      "Select at least one review area as Review or Focus before running analysis.",
    );
  }

  const snapshot = DesignAnalysisInputSnapshotSchema.parse({
    kind: "design",
    reviewId,
    imageRevisionId: aggregate.imageRevision.id,
    context: aggregate.review.context,
    images: aggregate.imageRevision.images.map(({ asset, position, analysisRole }) => ({
      imageId: asset.id,
      order: position,
      sanitizedDigest: asset.contentDigest,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteSize: asset.byteSize,
      analysisRole,
    })),
    reviewAreas,
    passConfigurations: buildPassConfigurations(DESIGN_PASS_IDS, config),
    operationalLimits: buildOperationalLimits(config, DESIGN_PASS_IDS.length),
    capturedAt: new Date().toISOString(),
  });

  const run = repositories.analysisRuns.create({
    reviewId,
    kind: "design",
    imageRevisionId: snapshot.imageRevisionId,
    idempotencyKey: normaliseIdempotencyKey(options.idempotencyKey),
    inputSnapshot: snapshot,
    passes: DESIGN_PASS_IDS.map((key, position) => ({ key, position })),
  });
  return requireRunDetail(run.id);
}

export function enqueueCriteriaAnalysis(
  reviewId: string,
  designAnalysisId: string,
  options: EnqueueOptions = {},
): AnalysisRunDetail {
  const repositories = createRepositories();
  const aggregate = repositories.reviews.getAggregate(reviewId);
  if (!aggregate) {
    throw new AppError("not_found", "The review was not found.");
  }
  if (aggregate.review.lifecycle !== "active") {
    throw new AppError("conflict", "A closed review cannot start another analysis.");
  }

  const selectedRow = repositories.analysisArtifacts.getDesignAnalysis(designAnalysisId);
  if (!selectedRow || selectedRow.reviewId !== reviewId) {
    throw new AppError("not_found", "The selected Design Analysis was not found for this review.");
  }
  const selectedDesign = parseDesignAnalysisRow(selectedRow);

  const criteria = CriteriaSnapshotSchema.parse(
    aggregate.criteria.map((criterion) => ({
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
    })),
  );
  const config = requireLiveAnalysisConfiguration();
  const designSnapshot = selectedDesign.inputSnapshot;
  const snapshot = CriteriaAnalysisInputSnapshotSchema.parse({
    kind: "criteria",
    reviewId,
    imageRevisionId: designSnapshot.imageRevisionId,
    designAnalysisId: selectedDesign.id,
    designAnalysisVersion: selectedDesign.version,
    context: designSnapshot.context,
    images: designSnapshot.images,
    reviewAreas: designSnapshot.reviewAreas,
    criteria,
    passConfigurations: buildPassConfigurations(CRITERIA_PASS_IDS, config),
    operationalLimits: buildOperationalLimits(config, CRITERIA_PASS_IDS.length),
    capturedAt: new Date().toISOString(),
  });
  assertCriteriaSnapshotMatchesDesignSnapshot(snapshot, designSnapshot);

  const run = repositories.analysisRuns.create({
    reviewId,
    kind: "criteria",
    imageRevisionId: snapshot.imageRevisionId,
    selectedDesignAnalysisId: selectedDesign.id,
    idempotencyKey: normaliseIdempotencyKey(options.idempotencyKey),
    inputSnapshot: snapshot,
    passes: CRITERIA_PASS_IDS.map((key, position) => ({ key, position })),
  });
  return requireRunDetail(run.id);
}

export function getAnalysisRun(runId: string): ReturnType<typeof analysisRunDto> {
  return analysisRunDto(requireRunDetail(runId));
}

export function getAnalysisRunPayload(runId: string) {
  const repositories = createRepositories();
  const detail = requireRunDetail(runId);
  const designRow = repositories.analysisArtifacts.getDesignAnalysisForRun(runId);
  const criteriaRow = repositories.analysisArtifacts.getCriteriaAnalysisForRun(runId);
  return {
    run: analysisRunDto(detail),
    designAnalysis: designRow ? parseDesignAnalysisRow(designRow) : null,
    criteriaAnalysis: criteriaRow ? parseCriteriaAnalysisRow(criteriaRow) : null,
  };
}

export async function cancelAnalysisRun(runId: string) {
  const repositories = createRepositories();
  const run = repositories.analysisRuns.requestCancellation(runId);
  if (run.state === "running") {
    const { signalAnalysisCancellation } = await import("@/lib/analysis/worker");
    signalAnalysisCancellation(runId);
  }
  return analysisRunDto(requireRunDetail(runId));
}

/** Resume the failed pass in place when possible, preserving completed passes. */
export function retryAnalysisRun(runId: string): AnalysisRunDetail {
  const repositories = createRepositories();
  const previous = repositories.analysisRuns.requireById(runId);
  if (previous.state !== "failed" && previous.state !== "interrupted") {
    throw new AppError("conflict", "Only a failed or interrupted analysis can be retried.");
  }
  const previousDetail = requireRunDetail(runId);
  const failedPass = previousDetail.passes.find(
    ({ state }) => state === "failed" || state === "interrupted",
  );
  if (failedPass) {
    repositories.analysisRuns.retryPass(failedPass.id);
    return requireRunDetail(runId);
  }

  // Preflight failures can occur before a pass starts. Preserve that failed
  // audit record and create another run from the exact same immutable input.
  const snapshot = AnalysisInputSnapshotSchema.parse(previous.inputSnapshot);
  const passIds = snapshot.kind === "design" ? DESIGN_PASS_IDS : CRITERIA_PASS_IDS;
  const run = repositories.analysisRuns.create({
    reviewId: previous.reviewId,
    kind: previous.kind,
    imageRevisionId: previous.imageRevisionId,
    selectedDesignAnalysisId: previous.selectedDesignAnalysisId,
    inputSnapshot: snapshot,
    passes: passIds.map((key, position) => ({ key, position })),
  });
  return requireRunDetail(run.id);
}

export function parseDesignAnalysisRow(row: DesignAnalysisRow): DesignAnalysis {
  return DesignAnalysisSchema.parse({
    id: row.id,
    reviewId: row.reviewId,
    version: row.version,
    createdAt: row.createdAt,
    inputSnapshot: row.inputSnapshot,
    passProvenance: row.passProvenance,
    ...recordValue(row.artifact, "Design Analysis"),
  });
}

export function parseCriteriaAnalysisRow(row: CriteriaAnalysisRow): CriteriaAnalysis {
  return CriteriaAnalysisSchema.parse({
    id: row.id,
    reviewId: row.reviewId,
    version: row.version,
    designAnalysisId: row.designAnalysisId,
    createdAt: row.createdAt,
    inputSnapshot: row.inputSnapshot,
    passProvenance: row.passProvenance,
    ...recordValue(row.artifact, "Criteria Analysis"),
  });
}

export function parseRunSnapshot(run: AnalysisRunRow) {
  return run.kind === "design"
    ? DesignAnalysisInputSnapshotSchema.parse(run.inputSnapshot)
    : CriteriaAnalysisInputSnapshotSchema.parse(run.inputSnapshot);
}

export function analysisRunDto(detail: AnalysisRunDetail) {
  return {
    id: detail.id,
    reviewId: detail.reviewId,
    kind: detail.kind,
    state: detail.state,
    cancelRequested: detail.cancelRequested,
    createdAt: detail.createdAt,
    startedAt: detail.startedAt,
    completedAt: detail.completedAt,
    error:
      detail.safeErrorCode && detail.safeErrorMessage
        ? {
            code: detail.safeErrorCode,
            message: detail.safeErrorMessage,
            retryable: isRetryableSafeCode(detail.safeErrorCode),
          }
        : null,
    passes: detail.passes.map((pass) => ({
      id: pass.id,
      passId: pass.passKey,
      state: pass.state,
      position: pass.position,
      startedAt: pass.startedAt,
      completedAt: pass.completedAt,
      error:
        pass.safeErrorCode && pass.safeErrorMessage
          ? {
              code: pass.safeErrorCode,
              message: pass.safeErrorMessage,
              retryable: isRetryableSafeCode(pass.safeErrorCode),
            }
          : null,
      attempts: pass.attempts.map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        state: attempt.state,
        provider: attempt.provider,
        model: attempt.model,
        imageDetail: attempt.imageDetail,
        reasoningEffort: attempt.reasoningEffort,
        promptVersion: attempt.promptVersion,
        schemaVersion: attempt.schemaVersion,
        durationMs: attempt.durationMs,
        requestId: attempt.apiRequestId,
        usage:
          attempt.inputTokens !== null &&
          attempt.outputTokens !== null &&
          attempt.totalTokens !== null
            ? {
                inputTokens: attempt.inputTokens,
                cachedInputTokens: attempt.cachedInputTokens ?? 0,
                cacheWriteInputTokens: attempt.cacheWriteInputTokens ?? 0,
                outputTokens: attempt.outputTokens,
                reasoningOutputTokens: attempt.reasoningOutputTokens ?? 0,
                totalTokens: attempt.totalTokens,
                estimatedCostMicroUsd: attempt.estimatedCostMicroUsd,
              }
            : null,
      })),
    })),
  };
}

function buildPassConfigurations(
  passIds: readonly AnalysisPassId[],
  config: RuntimeConfig,
): PassConfigurationSnapshot[] {
  return passIds.map((passId) => {
    const prompt = getPromptDefinition(passId);
    const model =
      prompt.modelRole === "vision" ? config.openaiVisionModel : config.openaiSynthesisModel;
    if (!model) {
      throw new AppError("configuration_error", "The required OpenAI model is not configured.");
    }
    return {
      passId,
      modelConfiguration: {
        provider: "openai" as const,
        model,
        ...(prompt.requiresImages ? { imageDetail: config.openaiImageDetail } : {}),
        reasoningEffort: config.openaiReasoningEffort,
        store: false as const,
      },
      promptVersion: prompt.version,
      schemaVersion: prompt.schemaVersion,
    };
  });
}

function buildOperationalLimits(config: RuntimeConfig, passCount: number) {
  const maximumPassAttempts = config.modelSchemaRetries + 1;
  const calculatedRunTimeout =
    config.modelRequestTimeoutMs * maximumPassAttempts * passCount + 60_000;
  return {
    maximumImages: config.limits.imagesPerReview,
    maximumBytesPerImage: config.limits.imageBytes,
    maximumPixelsPerImage: config.limits.imagePixels,
    maximumAggregateUploadBytes: config.limits.totalImageBytes,
    maximumContextCharacters: config.limits.contextLength,
    maximumCriteria: config.limits.criteriaCount,
    maximumJudgementStatementsPerCriterion: config.limits.judgementsPerCriterion,
    maximumPassAttempts,
    passTimeoutMs: config.modelRequestTimeoutMs,
    runTimeoutMs: Math.min(calculatedRunTimeout, 86_400_000),
    maximumOutputTokensPerPass: config.maxOutputTokensPerPass,
  };
}

function requireLiveAnalysisConfiguration(): RuntimeConfig {
  const config = getRuntimeConfig();
  if (config.analysisGateway === "fake") {
    throw new AppError(
      "configuration_error",
      "The explicit test gateway cannot create saved review findings. Select the OpenAI gateway to run analysis.",
    );
  }
  if (!config.openaiApiKey || !config.openaiVisionModel || !config.openaiSynthesisModel) {
    throw new AppError(
      "configuration_error",
      "OPENAI_API_KEY, OPENAI_VISION_MODEL, and OPENAI_SYNTHESIS_MODEL must be configured on the server.",
    );
  }
  return config;
}

function requireRunDetail(runId: string): AnalysisRunDetail {
  const detail = createRepositories().analysisRuns.getDetail(runId);
  if (!detail) throw new AppError("not_found", "The analysis run was not found.");
  return detail;
}

function normaliseIdempotencyKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) {
    throw new AppError("bad_request", "The idempotency key is too long.");
  }
  return trimmed;
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("database_error", `The saved ${label} record is invalid.`);
  }
  return value as Record<string, unknown>;
}

function isRetryableSafeCode(code: string): boolean {
  return ["rate_limit", "timeout", "service_unavailable", "invalid_structure", "invalid_semantics"].includes(
    code,
  );
}

export function validatePassProvenance(input: unknown, length: 5 | 6) {
  return PassProvenanceSchema.array().length(length).parse(input);
}

export type ParsedRunSnapshot = DesignAnalysisInputSnapshot | CriteriaAnalysisInputSnapshot;
