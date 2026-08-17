import "server-only";

import { randomUUID } from "node:crypto";

import {
  CriteriaAnalysisSchema,
  DesignAnalysisSchema,
  type AnalysisPassId,
  type CriteriaAnalysisInputSnapshot,
  type DesignAnalysisInputSnapshot,
} from "@/lib/domain";
import {
  createRepositories,
  type AnalysisRunRow,
  type PassAttemptRow,
} from "@/lib/db";
import {
  ANALYSIS_SCHEMA_VERSION,
  parseDesignAnalysisRow,
  parseRunSnapshot,
  validatePassProvenance,
} from "@/lib/application/analysis";
import { encryptedRecordFromRow, getImageTools } from "@/lib/application/images";
import {
  executeCriteriaPipeline,
  executeDesignPipeline,
  toSafeAnalysisError,
  type PipelineObserver,
} from "@/lib/analysis/pipeline";
import { buildOpenAIGatewayOptions } from "@/lib/analysis/gateway-options";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { AppError } from "@/lib/http/errors";
import { logger } from "@/lib/logging/logger";
import { OpenAIModelGateway, type AnalysisImageInput, type ModelGateway } from "@/lib/openai";

const WORKER_ID = `local-${process.pid}-${randomUUID()}`;
const activeControllers = new Map<string, AbortController>();
let drainPromise: Promise<void> | null = null;
let anotherDrainRequested = false;

export function kickAnalysisWorker(): void {
  if (drainPromise) {
    anotherDrainRequested = true;
    return;
  }
  drainPromise = drainQueuedRuns()
    .catch((error) => {
      logger.error({
        event: "analysis.worker_failed",
        errorCode: toSafeAnalysisError(error).code,
      });
    })
    .finally(() => {
      drainPromise = null;
      if (anotherDrainRequested) {
        anotherDrainRequested = false;
        queueMicrotask(kickAnalysisWorker);
      }
    });
}

export function signalAnalysisCancellation(runId: string): void {
  activeControllers.get(runId)?.abort();
}

export function recoverAndKickAnalysisWorker(): void {
  const interrupted = createRepositories().analysisRuns.interruptExpiredRuns();
  if (interrupted.length > 0) {
    logger.warn({ event: "analysis.runs_interrupted", inputCount: interrupted.length });
  }
  kickAnalysisWorker();
}

async function drainQueuedRuns(): Promise<void> {
  const repositories = createRepositories();
  const config = getRuntimeConfig();
  repositories.analysisRuns.interruptExpiredRuns();

  while (true) {
    const claimed = repositories.analysisRuns.claimNextQueued(
      WORKER_ID,
      config.analysisLeaseMs,
    );
    if (!claimed) return;
    await executeClaimedRun(claimed);
  }
}

async function executeClaimedRun(run: AnalysisRunRow): Promise<void> {
  const repositories = createRepositories();
  const snapshot = parseRunSnapshot(run);
  const controller = new AbortController();
  activeControllers.set(run.id, controller);
  const timeout = setTimeout(() => controller.abort(), snapshot.operationalLimits.runTimeoutMs);
  timeout.unref?.();
  const cancellationPoll = setInterval(() => {
    const current = repositories.analysisRuns.getById(run.id);
    if (!current || current.cancelRequested || current.state !== "running") {
      controller.abort();
    }
  }, 750);
  cancellationPoll.unref?.();
  const config = getRuntimeConfig();
  const leaseInterval = setInterval(() => {
    try {
      repositories.analysisRuns.renewLease(run.id, WORKER_ID, config.analysisLeaseMs);
    } catch (error) {
      logger.warn({
        event: "analysis.lease_lost",
        runId: run.id,
        errorCode: toSafeAnalysisError(error).code,
      });
      controller.abort();
    }
  }, Math.max(1_000, Math.min(60_000, Math.floor(config.analysisLeaseMs / 2))));
  leaseInterval.unref?.();

  const images: AnalysisImageInput[] = [];
  logger.info({
    event: "analysis.started",
    reviewId: run.reviewId,
    runId: run.id,
    inputCount: snapshot.images.length,
  });

  try {
    const gateway = createLiveGateway(snapshot);
    images.push(...(await loadSnapshotImages(snapshot)));
    const observer = createPersistenceObserver(run, snapshot);
    const resumedPassOutputs = completedPassOutputs(run.id, snapshot);

    if (snapshot.kind === "design") {
      const result = await executeDesignPipeline(snapshot, {
        gateway,
        images,
        resumedPassOutputs,
        observer,
        signal: controller.signal,
      });
      await finishDesignRun(run, snapshot, result);
    } else {
      const designRow = repositories.analysisArtifacts.getDesignAnalysis(
        snapshot.designAnalysisId,
      );
      if (!designRow || designRow.reviewId !== run.reviewId) {
        throw new AppError(
          "analysis_not_ready",
          "The Design Analysis selected by this run is no longer available.",
        );
      }
      const designAnalysis = parseDesignAnalysisRow(designRow);
      const result = await executeCriteriaPipeline(snapshot, designAnalysis.findings, {
        gateway,
        images,
        resumedPassOutputs,
        observer,
        signal: controller.signal,
      });
      await finishCriteriaRun(run, snapshot, result);
    }

    logger.info({
      event: "analysis.completed",
      reviewId: run.reviewId,
      runId: run.id,
    });
  } catch (error) {
    const current = repositories.analysisRuns.getById(run.id);
    if (current?.state === "running" && current.cancelRequested) {
      repositories.analysisRuns.finishCancellation(run.id);
      logger.info({ event: "analysis.cancelled", reviewId: run.reviewId, runId: run.id });
    } else if (current?.state === "running") {
      const safe = toSafeAnalysisError(error);
      repositories.analysisRuns.transitionRun(run.id, "failed", safe);
      logger.error({
        event: "analysis.failed",
        reviewId: run.reviewId,
        runId: run.id,
        errorCode: safe.code,
      });
    }
  } finally {
    clearInterval(leaseInterval);
    clearInterval(cancellationPoll);
    clearTimeout(timeout);
    activeControllers.delete(run.id);
    for (const image of images) image.bytes.fill(0);
  }
}

async function loadSnapshotImages(
  snapshot: DesignAnalysisInputSnapshot | CriteriaAnalysisInputSnapshot,
): Promise<AnalysisImageInput[]> {
  const repositories = createRepositories();
  const { store } = getImageTools();
  const imageDetail =
    snapshot.passConfigurations.find(({ modelConfiguration }) =>
      Boolean(modelConfiguration.imageDetail),
    )?.modelConfiguration.imageDetail ?? "auto";
  const loaded: AnalysisImageInput[] = [];

  try {
    for (const manifestItem of [...snapshot.images].sort((left, right) => left.order - right.order)) {
      const row = repositories.reviews.getImageAsset(manifestItem.imageId);
      if (
        !row ||
        row.reviewId !== snapshot.reviewId ||
        row.retentionState !== "retained" ||
        row.contentDigest !== manifestItem.sanitizedDigest ||
        row.mimeType !== manifestItem.mimeType ||
        row.width !== manifestItem.width ||
        row.height !== manifestItem.height
      ) {
        throw new AppError(
          "image_missing",
          "A source image in the immutable analysis snapshot is unavailable or has changed.",
        );
      }
      const record = encryptedRecordFromRow(row);
      if (!record) {
        throw new AppError("image_missing", "A retained source image is unavailable.");
      }
      const bytes = await store.readAnalysis(record);
      loaded.push({
        id: row.id,
        order: manifestItem.order,
        analysisRole: manifestItem.analysisRole,
        mimeType: row.mimeType,
        bytes,
        detail: imageDetail,
      });
    }
    return loaded;
  } catch (error) {
    for (const image of loaded) image.bytes.fill(0);
    throw error;
  }
}

function createLiveGateway(
  snapshot: DesignAnalysisInputSnapshot | CriteriaAnalysisInputSnapshot,
): ModelGateway {
  const config = getRuntimeConfig();
  return new OpenAIModelGateway(buildOpenAIGatewayOptions(snapshot, config));
}

function createPersistenceObserver(
  run: AnalysisRunRow,
  snapshot: DesignAnalysisInputSnapshot | CriteriaAnalysisInputSnapshot,
): PipelineObserver {
  const repositories = createRepositories();
  const activeAttempts = new Map<AnalysisPassId, PassAttemptRow>();

  return {
    onAttemptStarted({ passId }) {
      const pass = repositories.analysisRuns.getPassByKey(run.id, passId);
      const configuration = snapshot.passConfigurations.find(
        (candidate) => candidate.passId === passId,
      );
      if (!pass || !configuration) {
        throw new AppError("database_error", `Analysis pass ${passId} is unavailable.`);
      }
      const attempt = repositories.analysisRuns.beginPassAttempt(pass.id, {
        provider: configuration.modelConfiguration.provider,
        model: configuration.modelConfiguration.model,
        imageDetail: configuration.modelConfiguration.imageDetail,
        reasoningEffort: configuration.modelConfiguration.reasoningEffort,
        promptVersion: configuration.promptVersion,
        schemaVersion: configuration.schemaVersion,
      });
      activeAttempts.set(passId, attempt);
      logger.info({
        event: "analysis.pass_started",
        reviewId: run.reviewId,
        runId: run.id,
        passId,
        attempt: attempt.attemptNumber,
        model: attempt.model,
      });
    },
    onPassCompleted(event) {
      const attempt = activeAttempts.get(event.passId);
      if (!attempt) throw new AppError("database_error", "The active pass attempt was lost.");
      const usage = completeUsage(event.result.usage);
      repositories.analysisRuns.completePassAttempt(attempt.id, {
        validatedOutput: event.output,
        durationMs: event.durationMs,
        responseReceivedAt: event.completedAt,
        apiRequestId: event.result.requestId,
        usage,
      });
      activeAttempts.delete(event.passId);
      logger.info({
        event: "analysis.pass_completed",
        reviewId: run.reviewId,
        runId: run.id,
        passId: event.passId,
        attempt: attempt.attemptNumber,
        durationMs: event.durationMs,
        requestId: event.result.requestId,
        model: event.result.model,
        ...(usage ? { usage } : {}),
      });
    },
    onAttemptFailed(event) {
      const attempt = activeAttempts.get(event.passId);
      if (!attempt) return;
      repositories.analysisRuns.failPassAttempt(attempt.id, {
        failure: event.error,
        durationMs: event.durationMs,
      });
      activeAttempts.delete(event.passId);
      logger.warn({
        event: "analysis.pass_failed",
        reviewId: run.reviewId,
        runId: run.id,
        passId: event.passId,
        attempt: attempt.attemptNumber,
        durationMs: event.durationMs,
        errorCode: event.error.code,
        ...(event.semanticIssuePaths
          ? { semanticIssuePaths: event.semanticIssuePaths }
          : {}),
      });
    },
    onPassSkipped(event) {
      const pass = repositories.analysisRuns.getPassByKey(run.id, event.passId);
      if (!pass) throw new AppError("database_error", "The skipped pass record is unavailable.");
      repositories.analysisRuns.skipPass(pass.id);
      logger.info({
        event: "analysis.pass_skipped",
        reviewId: run.reviewId,
        runId: run.id,
        passId: event.passId,
      });
    },
  };
}

function completedPassOutputs(
  runId: string,
  snapshot: DesignAnalysisInputSnapshot | CriteriaAnalysisInputSnapshot,
): Partial<Record<AnalysisPassId, unknown>> {
  const detail = createRepositories().analysisRuns.getDetail(runId);
  if (!detail) throw new AppError("database_error", "The analysis run disappeared.");
  const outputs: Partial<Record<AnalysisPassId, unknown>> = {};
  for (const pass of detail.passes) {
    const configuration = snapshot.passConfigurations.find(
      ({ passId }) => passId === pass.passKey,
    );
    if (!configuration || pass.state !== "completed") continue;
    const attempt = [...pass.attempts]
      .reverse()
      .find((candidate) => candidate.state === "completed");
    if (attempt?.validatedOutput !== null && attempt?.validatedOutput !== undefined) {
      outputs[configuration.passId] = attempt.validatedOutput;
    }
  }
  return outputs;
}

async function finishDesignRun(
  run: AnalysisRunRow,
  snapshot: DesignAnalysisInputSnapshot,
  result: Awaited<ReturnType<typeof executeDesignPipeline>>,
): Promise<void> {
  const repositories = createRepositories();
  const provenance = buildPassProvenance(run.id, snapshot);
  const artifact = {
    evidence: result.evidence,
    findings: result.findings,
    synthesis: result.synthesis,
  };
  const artifactId = randomUUID();
  DesignAnalysisSchema.parse({
    id: artifactId,
    reviewId: run.reviewId,
    version: 1,
    createdAt: new Date().toISOString(),
    inputSnapshot: snapshot,
    passProvenance: provenance,
    ...artifact,
  });
  repositories.analysisArtifacts.finaliseDesignRun({
    id: artifactId,
    runId: run.id,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    promptSetVersion: promptSetVersion(snapshot),
    passProvenance: provenance,
    artifact,
  });
}

async function finishCriteriaRun(
  run: AnalysisRunRow,
  snapshot: CriteriaAnalysisInputSnapshot,
  result: Awaited<ReturnType<typeof executeCriteriaPipeline>>,
): Promise<void> {
  const repositories = createRepositories();
  const provenance = buildPassProvenance(run.id, snapshot);
  const artifact = { results: result.results, synthesis: result.synthesis };
  const artifactId = randomUUID();
  CriteriaAnalysisSchema.parse({
    id: artifactId,
    reviewId: run.reviewId,
    version: 1,
    designAnalysisId: snapshot.designAnalysisId,
    createdAt: new Date().toISOString(),
    inputSnapshot: snapshot,
    passProvenance: provenance,
    ...artifact,
  });
  repositories.analysisArtifacts.finaliseCriteriaRun({
    id: artifactId,
    runId: run.id,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    promptSetVersion: promptSetVersion(snapshot),
    criteriaSnapshot: snapshot.criteria,
    passProvenance: provenance,
    artifact,
  });
}

function buildPassProvenance(
  runId: string,
  snapshot: DesignAnalysisInputSnapshot | CriteriaAnalysisInputSnapshot,
): ReturnType<typeof validatePassProvenance> {
  const detail = createRepositories().analysisRuns.getDetail(runId);
  if (!detail) throw new AppError("database_error", "The analysis run disappeared.");
  const values = detail.passes.map((pass) => {
    const configuration = snapshot.passConfigurations.find(
      (candidate) => candidate.passId === pass.passKey,
    );
    if (!configuration || !pass.completedAt) {
      throw new AppError("database_error", "Analysis pass provenance is incomplete.");
    }
    if (pass.state === "skipped") {
      return {
        passId: configuration.passId,
        state: "skipped" as const,
        promptVersion: configuration.promptVersion,
        schemaVersion: configuration.schemaVersion,
        completedAt: pass.completedAt,
      };
    }
    const attempt = [...pass.attempts]
      .reverse()
      .find((candidate) => candidate.state === "completed");
    if (pass.state !== "completed" || !attempt || attempt.durationMs === null) {
      throw new AppError("database_error", "Completed pass provenance is incomplete.");
    }
    const usage =
      attempt.inputTokens !== null &&
      attempt.outputTokens !== null &&
      attempt.totalTokens !== null
        ? {
            inputTokens: attempt.inputTokens,
            outputTokens: attempt.outputTokens,
            totalTokens: attempt.totalTokens,
          }
        : undefined;
    return {
      passId: configuration.passId,
      state: "completed" as const,
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      modelConfiguration: configuration.modelConfiguration,
      promptVersion: configuration.promptVersion,
      schemaVersion: configuration.schemaVersion,
      durationMs: attempt.durationMs,
      ...(usage ? { usage } : {}),
      completedAt: attempt.completedAt ?? pass.completedAt,
    };
  });
  return validatePassProvenance(values, snapshot.kind === "design" ? 6 : 5);
}

function completeUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} | undefined) {
  if (
    usage?.inputTokens === undefined ||
    usage.outputTokens === undefined ||
    usage.totalTokens === undefined
  ) {
    return undefined;
  }
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
  };
}

function promptSetVersion(
  snapshot: DesignAnalysisInputSnapshot | CriteriaAnalysisInputSnapshot,
): string {
  return [...new Set(snapshot.passConfigurations.map(({ promptVersion }) => promptVersion))]
    .join("+")
    .slice(0, 64);
}
