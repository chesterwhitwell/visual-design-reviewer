import { and, asc, eq, inArray, lt, max } from "drizzle-orm";

import type { AppDatabase } from "../client";
import {
  analysisPasses,
  analysisRuns,
  designAnalyses,
  imageAssets,
  passAttempts,
  reviewImageRevisionItems,
  reviewImageRevisions,
  reviews,
  type AnalysisPassRow,
  type AnalysisRunRow,
  type JsonSnapshot,
  type PassAttemptRow,
} from "../schema";
import {
  InvalidStateTransitionError,
  PersistenceConflictError,
  PersistenceValidationError,
  RecordNotFoundError,
} from "./errors";
import {
  type Clock,
  type IdFactory,
  type RepositoryDependencies,
  type SafeFailure,
  type UsageMetadata,
  systemClock,
  systemIdFactory,
} from "./shared";

export type AnalysisKind = "design" | "criteria";
export type AnalysisRunState = AnalysisRunRow["state"];
export type AnalysisPassState = AnalysisPassRow["state"];
export type PassAttemptState = PassAttemptRow["state"];

export interface AnalysisPassDefinition {
  key: string;
  position: number;
  id?: string;
}

export interface CreateAnalysisRunInput {
  id?: string;
  reviewId: string;
  kind: AnalysisKind;
  imageRevisionId: string;
  selectedDesignAnalysisId?: string | null;
  idempotencyKey?: string | null;
  inputSnapshot: JsonSnapshot;
  passes: readonly AnalysisPassDefinition[];
}

export interface AnalysisRunWithPasses extends AnalysisRunRow {
  passes: AnalysisPassRow[];
}

export interface AnalysisPassWithAttempts extends AnalysisPassRow {
  attempts: PassAttemptRow[];
}

export interface AnalysisRunDetail extends AnalysisRunRow {
  passes: AnalysisPassWithAttempts[];
}

export interface BeginPassAttemptInput {
  id?: string;
  provider: string;
  model: string;
  imageDetail?: string | null;
  reasoningEffort?: string | null;
  promptVersion: string;
  schemaVersion: string;
}

export interface CompletePassAttemptInput {
  validatedOutput: unknown;
  durationMs: number;
  responseReceivedAt?: string;
  apiStatusCode?: number | null;
  apiRequestId?: string | null;
  usage?: UsageMetadata;
}

export interface FailPassAttemptInput {
  state?: "failed" | "cancelled" | "interrupted";
  failure: SafeFailure;
  durationMs: number;
  responseReceivedAt?: string | null;
  apiStatusCode?: number | null;
  apiRequestId?: string | null;
  usage?: UsageMetadata;
}

const RUN_TRANSITIONS: Record<AnalysisRunState, readonly AnalysisRunState[]> = {
  queued: ["running", "cancelled"],
  running: ["completed", "failed", "cancelled", "interrupted"],
  completed: [],
  failed: ["queued", "cancelled"],
  cancelled: [],
  interrupted: ["queued", "running", "failed", "cancelled"],
};

const PASS_TRANSITIONS: Record<AnalysisPassState, readonly AnalysisPassState[]> = {
  pending: ["running", "skipped", "cancelled"],
  running: ["completed", "failed", "cancelled", "interrupted"],
  completed: [],
  failed: ["pending", "running", "cancelled"],
  cancelled: [],
  skipped: [],
  interrupted: ["pending", "running", "cancelled"],
};

function assertUniquePassDefinitions(definitions: readonly AnalysisPassDefinition[]): void {
  if (definitions.length === 0) {
    throw new PersistenceValidationError("An analysis run must contain at least one pass");
  }
  const keys = definitions.map((definition) => definition.key);
  const positions = definitions.map((definition) => definition.position);
  if (new Set(keys).size !== keys.length) {
    throw new PersistenceValidationError("Analysis pass keys must be unique within a run");
  }
  if (new Set(positions).size !== positions.length) {
    throw new PersistenceValidationError("Analysis pass positions must be unique within a run");
  }
  if (positions.some((position) => !Number.isInteger(position) || position < 0)) {
    throw new PersistenceValidationError("Analysis pass positions must be non-negative integers");
  }
}

export class AnalysisRunRepository {
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(
    private readonly db: AppDatabase,
    dependencies: RepositoryDependencies = {},
  ) {
    this.clock = dependencies.clock ?? systemClock;
    this.idFactory = dependencies.idFactory ?? systemIdFactory;
  }

  create(input: CreateAnalysisRunInput): AnalysisRunWithPasses {
    assertUniquePassDefinitions(input.passes);
    if (input.kind === "design" && input.selectedDesignAnalysisId) {
      throw new PersistenceValidationError(
        "A Design Analysis run cannot select an earlier Design Analysis",
      );
    }
    if (input.kind === "criteria" && !input.selectedDesignAnalysisId) {
      throw new PersistenceValidationError(
        "A Criteria Analysis run must select a Design Analysis",
      );
    }

    if (input.idempotencyKey) {
      const existing = this.db
        .select()
        .from(analysisRuns)
        .where(
          and(
            eq(analysisRuns.reviewId, input.reviewId),
            eq(analysisRuns.kind, input.kind),
            eq(analysisRuns.idempotencyKey, input.idempotencyKey),
          ),
        )
        .get();
      if (existing) return this.requireWithPasses(existing.id);
    }

    const revision = this.db
      .select()
      .from(reviewImageRevisions)
      .where(eq(reviewImageRevisions.id, input.imageRevisionId))
      .get();
    if (!revision || revision.reviewId !== input.reviewId) {
      throw new PersistenceValidationError(
        "The selected image revision must exist and belong to the review",
      );
    }

    if (input.selectedDesignAnalysisId) {
      const selected = this.db
        .select({ reviewId: designAnalyses.reviewId })
        .from(designAnalyses)
        .where(eq(designAnalyses.id, input.selectedDesignAnalysisId))
        .get();
      if (!selected || selected.reviewId !== input.reviewId) {
        throw new PersistenceValidationError(
          "The selected Design Analysis must exist and belong to the review",
        );
      }
    }

    const runId = input.id ?? this.idFactory();
    const timestamp = this.clock();
    const persistedRunId = this.db.transaction((tx) => {
      if (input.idempotencyKey) {
        const existing = tx
          .select({ id: analysisRuns.id })
          .from(analysisRuns)
          .where(
            and(
              eq(analysisRuns.reviewId, input.reviewId),
              eq(analysisRuns.kind, input.kind),
              eq(analysisRuns.idempotencyKey, input.idempotencyKey),
            ),
          )
          .get();
        if (existing) return existing.id;
      }

      const review = tx
        .select({ lifecycle: reviews.lifecycle })
        .from(reviews)
        .where(eq(reviews.id, input.reviewId))
        .get();
      if (!review || review.lifecycle !== "active") {
        throw new PersistenceConflictError(
          "An analysis run can only be created for an active review",
        );
      }

      const revisionAssets = tx
        .select({ retentionState: imageAssets.retentionState })
        .from(reviewImageRevisionItems)
        .innerJoin(imageAssets, eq(reviewImageRevisionItems.imageAssetId, imageAssets.id))
        .where(eq(reviewImageRevisionItems.revisionId, input.imageRevisionId))
        .all();
      if (
        revisionAssets.length === 0 ||
        revisionAssets.some((asset) => asset.retentionState !== "retained")
      ) {
        throw new PersistenceConflictError(
          "Every image required by an analysis run must still be locally retained",
        );
      }

      tx.insert(analysisRuns)
        .values({
          id: runId,
          reviewId: input.reviewId,
          kind: input.kind,
          imageRevisionId: input.imageRevisionId,
          selectedDesignAnalysisId: input.selectedDesignAnalysisId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          inputSnapshot: input.inputSnapshot,
          state: "queued",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
      tx.insert(analysisPasses)
        .values(
          input.passes.map((definition) => ({
            id: definition.id ?? this.idFactory(),
            runId,
            passKey: definition.key,
            position: definition.position,
            state: "pending" as const,
            createdAt: timestamp,
            updatedAt: timestamp,
          })),
        )
        .run();
      return runId;
    }, { behavior: "immediate" });

    return this.requireWithPasses(persistedRunId);
  }

  getById(runId: string): AnalysisRunRow | null {
    return this.db.select().from(analysisRuns).where(eq(analysisRuns.id, runId)).get() ?? null;
  }

  requireById(runId: string): AnalysisRunRow {
    const run = this.getById(runId);
    if (!run) throw new RecordNotFoundError(`Analysis run ${runId} was not found`);
    return run;
  }

  listByReview(reviewId: string): AnalysisRunRow[] {
    return this.db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.reviewId, reviewId))
      .orderBy(asc(analysisRuns.createdAt))
      .all();
  }

  getWithPasses(runId: string): AnalysisRunWithPasses | null {
    const run = this.getById(runId);
    if (!run) return null;
    return {
      ...run,
      passes: this.db
        .select()
        .from(analysisPasses)
        .where(eq(analysisPasses.runId, runId))
        .orderBy(asc(analysisPasses.position))
        .all(),
    };
  }

  requireWithPasses(runId: string): AnalysisRunWithPasses {
    const run = this.getWithPasses(runId);
    if (!run) throw new RecordNotFoundError(`Analysis run ${runId} was not found`);
    return run;
  }

  getDetail(runId: string): AnalysisRunDetail | null {
    const run = this.getWithPasses(runId);
    if (!run) return null;
    return {
      ...run,
      passes: run.passes.map((pass) => ({
        ...pass,
        attempts: this.listAttempts(pass.id),
      })),
    };
  }

  getPass(passId: string): AnalysisPassRow | null {
    return (
      this.db.select().from(analysisPasses).where(eq(analysisPasses.id, passId)).get() ?? null
    );
  }

  getPassByKey(runId: string, passKey: string): AnalysisPassRow | null {
    return (
      this.db
        .select()
        .from(analysisPasses)
        .where(and(eq(analysisPasses.runId, runId), eq(analysisPasses.passKey, passKey)))
        .get() ?? null
    );
  }

  requirePass(passId: string): AnalysisPassRow {
    const pass = this.getPass(passId);
    if (!pass) throw new RecordNotFoundError(`Analysis pass ${passId} was not found`);
    return pass;
  }

  transitionRun(
    runId: string,
    to: AnalysisRunState,
    failure?: SafeFailure,
  ): AnalysisRunRow {
    const run = this.requireById(runId);
    if (run.state === to) return run;
    if (!RUN_TRANSITIONS[run.state].includes(to)) {
      throw new InvalidStateTransitionError("run", run.state, to);
    }

    const timestamp = this.clock();
    const isTerminal = ["completed", "failed", "cancelled", "interrupted"].includes(to);
    const updated = this.db
      .update(analysisRuns)
      .set({
        state: to,
        updatedAt: timestamp,
        startedAt: to === "running" ? (run.startedAt ?? timestamp) : run.startedAt,
        completedAt: isTerminal ? timestamp : null,
        leaseOwner: isTerminal || to === "queued" ? null : run.leaseOwner,
        leaseExpiresAt: isTerminal || to === "queued" ? null : run.leaseExpiresAt,
        safeErrorCode: failure?.code ?? (to === "queued" || to === "running" ? null : run.safeErrorCode),
        safeErrorMessage:
          failure?.message ?? (to === "queued" || to === "running" ? null : run.safeErrorMessage),
        cancelRequested: to === "queued" ? false : run.cancelRequested,
      })
      .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.state, run.state)))
      .returning()
      .get();

    if (!updated) {
      throw new PersistenceConflictError(`Analysis run ${runId} changed concurrently`);
    }
    return updated;
  }

  transitionPass(
    passId: string,
    to: AnalysisPassState,
    failure?: SafeFailure,
  ): AnalysisPassRow {
    const pass = this.requirePass(passId);
    if (pass.state === to) return pass;
    if (!PASS_TRANSITIONS[pass.state].includes(to)) {
      throw new InvalidStateTransitionError("pass", pass.state, to);
    }

    const timestamp = this.clock();
    const isTerminal = ["completed", "failed", "cancelled", "skipped", "interrupted"].includes(
      to,
    );
    const updated = this.db
      .update(analysisPasses)
      .set({
        state: to,
        updatedAt: timestamp,
        startedAt: to === "running" ? (pass.startedAt ?? timestamp) : pass.startedAt,
        completedAt: isTerminal ? timestamp : null,
        safeErrorCode: failure?.code ?? (to === "pending" || to === "running" ? null : pass.safeErrorCode),
        safeErrorMessage:
          failure?.message ?? (to === "pending" || to === "running" ? null : pass.safeErrorMessage),
      })
      .where(and(eq(analysisPasses.id, passId), eq(analysisPasses.state, pass.state)))
      .returning()
      .get();

    if (!updated) {
      throw new PersistenceConflictError(`Analysis pass ${passId} changed concurrently`);
    }
    return updated;
  }

  skipPass(passId: string): AnalysisPassRow {
    return this.transitionPass(passId, "skipped");
  }

  claimNextQueued(workerId: string, leaseDurationMs: number): AnalysisRunRow | null {
    if (!workerId || leaseDurationMs <= 0) {
      throw new PersistenceValidationError("A worker ID and positive lease duration are required");
    }
    const timestamp = this.clock();
    const leaseExpiresAt = new Date(Date.parse(timestamp) + leaseDurationMs).toISOString();

    return this.db.transaction((tx) => {
      const candidate = tx
        .select()
        .from(analysisRuns)
        .where(and(eq(analysisRuns.state, "queued"), eq(analysisRuns.cancelRequested, false)))
        .orderBy(asc(analysisRuns.createdAt))
        .limit(1)
        .get();
      if (!candidate) return null;

      return (
        tx
          .update(analysisRuns)
          .set({
            state: "running",
            leaseOwner: workerId,
            leaseExpiresAt,
            startedAt: candidate.startedAt ?? timestamp,
            updatedAt: timestamp,
            completedAt: null,
          })
          .where(and(eq(analysisRuns.id, candidate.id), eq(analysisRuns.state, "queued")))
          .returning()
          .get() ?? null
      );
    }, { behavior: "immediate" });
  }

  renewLease(runId: string, workerId: string, leaseDurationMs: number): AnalysisRunRow {
    const timestamp = this.clock();
    const leaseExpiresAt = new Date(Date.parse(timestamp) + leaseDurationMs).toISOString();
    const updated = this.db
      .update(analysisRuns)
      .set({ leaseExpiresAt, updatedAt: timestamp })
      .where(
        and(
          eq(analysisRuns.id, runId),
          eq(analysisRuns.state, "running"),
          eq(analysisRuns.leaseOwner, workerId),
        ),
      )
      .returning()
      .get();
    if (!updated) {
      throw new PersistenceConflictError(`Worker ${workerId} does not hold the lease for run ${runId}`);
    }
    return updated;
  }

  interruptExpiredRuns(at = this.clock()): string[] {
    return this.db.transaction((tx) => {
      const expired = tx
        .select({ id: analysisRuns.id })
        .from(analysisRuns)
        .where(and(eq(analysisRuns.state, "running"), lt(analysisRuns.leaseExpiresAt, at)))
        .all();
      if (expired.length === 0) return [];
      const runIds = expired.map((run) => run.id);
      const timestamp = this.clock();

      const runningPasses = tx
        .select({ id: analysisPasses.id })
        .from(analysisPasses)
        .where(and(inArray(analysisPasses.runId, runIds), eq(analysisPasses.state, "running")))
        .all();
      if (runningPasses.length > 0) {
        const passIds = runningPasses.map((pass) => pass.id);
        tx.update(passAttempts)
          .set({ state: "interrupted", completedAt: timestamp })
          .where(and(inArray(passAttempts.passId, passIds), eq(passAttempts.state, "running")))
          .run();
        tx.update(analysisPasses)
          .set({ state: "interrupted", updatedAt: timestamp, completedAt: timestamp })
          .where(inArray(analysisPasses.id, passIds))
          .run();
      }
      tx.update(analysisRuns)
        .set({
          state: "interrupted",
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: timestamp,
          completedAt: timestamp,
          safeErrorCode: "worker_interrupted",
          safeErrorMessage: "The analysis worker stopped before the run completed.",
        })
        .where(inArray(analysisRuns.id, runIds))
        .run();
      return runIds;
    }, { behavior: "immediate" });
  }

  requestCancellation(runId: string): AnalysisRunRow {
    return this.db.transaction(
      (tx) => {
        const run = tx.select().from(analysisRuns).where(eq(analysisRuns.id, runId)).get();
        if (!run) throw new RecordNotFoundError(`Analysis run ${runId} was not found`);
        if (["completed", "failed", "cancelled", "interrupted"].includes(run.state)) return run;

        const timestamp = this.clock();
        const queued = run.state === "queued";
        if (queued) {
          tx.update(analysisPasses)
            .set({ state: "cancelled", updatedAt: timestamp, completedAt: timestamp })
            .where(
              and(eq(analysisPasses.runId, runId), eq(analysisPasses.state, "pending")),
            )
            .run();
        }
        const updated = tx
          .update(analysisRuns)
          .set({
            cancelRequested: true,
            state: queued ? "cancelled" : run.state,
            updatedAt: timestamp,
            completedAt: queued ? timestamp : run.completedAt,
            leaseOwner: queued ? null : run.leaseOwner,
            leaseExpiresAt: queued ? null : run.leaseExpiresAt,
          })
          .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.state, run.state)))
          .returning()
          .get();
        if (!updated) {
          throw new PersistenceConflictError(`Analysis run ${runId} changed concurrently`);
        }
        return updated;
      },
      { behavior: "immediate" },
    );
  }

  finishCancellation(runId: string): AnalysisRunWithPasses {
    const timestamp = this.clock();
    this.db.transaction(
      (tx) => {
        const run = tx.select().from(analysisRuns).where(eq(analysisRuns.id, runId)).get();
        if (!run) throw new RecordNotFoundError(`Analysis run ${runId} was not found`);
        if (run.state === "cancelled") return;
        if (run.state !== "running" || !run.cancelRequested) {
          throw new PersistenceConflictError(
            `Analysis run ${runId} does not have a pending cancellation request`,
          );
        }

        const activePasses = tx
          .select({ id: analysisPasses.id })
          .from(analysisPasses)
          .where(
            and(
              eq(analysisPasses.runId, runId),
              inArray(analysisPasses.state, ["pending", "running", "failed", "interrupted"]),
            ),
          )
          .all();
        if (activePasses.length > 0) {
          const passIds = activePasses.map((pass) => pass.id);
          tx.update(passAttempts)
            .set({
              state: "cancelled",
              completedAt: timestamp,
              safeErrorCode: "user_cancelled",
              safeErrorMessage: "The analysis was cancelled.",
            })
            .where(and(inArray(passAttempts.passId, passIds), eq(passAttempts.state, "running")))
            .run();
          tx.update(analysisPasses)
            .set({
              state: "cancelled",
              updatedAt: timestamp,
              completedAt: timestamp,
              safeErrorCode: "user_cancelled",
              safeErrorMessage: "The analysis was cancelled.",
            })
            .where(inArray(analysisPasses.id, passIds))
            .run();
        }
        tx.update(analysisRuns)
          .set({
            state: "cancelled",
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: timestamp,
            completedAt: timestamp,
            safeErrorCode: "user_cancelled",
            safeErrorMessage: "The analysis was cancelled.",
          })
          .where(and(eq(analysisRuns.id, runId), eq(analysisRuns.state, "running")))
          .run();
      },
      { behavior: "immediate" },
    );
    return this.requireWithPasses(runId);
  }

  beginPassAttempt(passId: string, input: BeginPassAttemptInput): PassAttemptRow {
    const timestamp = this.clock();
    const attemptId = input.id ?? this.idFactory();

    return this.db.transaction((tx) => {
      const pass = tx.select().from(analysisPasses).where(eq(analysisPasses.id, passId)).get();
      if (!pass) throw new RecordNotFoundError(`Analysis pass ${passId} was not found`);
      const run = tx.select().from(analysisRuns).where(eq(analysisRuns.id, pass.runId)).get();
      if (!run || run.state !== "running" || run.cancelRequested) {
        throw new PersistenceConflictError(
          `Analysis run ${pass.runId} is not available for another pass attempt`,
        );
      }
      if (!["pending", "failed", "interrupted", "running"].includes(pass.state)) {
        throw new InvalidStateTransitionError("pass", pass.state, "running");
      }
      const activeAttempt = tx
        .select({ id: passAttempts.id })
        .from(passAttempts)
        .where(and(eq(passAttempts.passId, passId), eq(passAttempts.state, "running")))
        .get();
      if (activeAttempt) {
        throw new PersistenceConflictError(`Analysis pass ${passId} already has a running attempt`);
      }

      const currentMaximum = tx
        .select({ value: max(passAttempts.attemptNumber) })
        .from(passAttempts)
        .where(eq(passAttempts.passId, passId))
        .get();
      const attemptNumber = (currentMaximum?.value ?? 0) + 1;

      tx.update(analysisPasses)
        .set({
          state: "running",
          updatedAt: timestamp,
          startedAt: pass.startedAt ?? timestamp,
          completedAt: null,
          safeErrorCode: null,
          safeErrorMessage: null,
        })
        .where(eq(analysisPasses.id, passId))
        .run();
      return tx
        .insert(passAttempts)
        .values({
          id: attemptId,
          passId,
          attemptNumber,
          state: "running",
          provider: input.provider,
          model: input.model,
          imageDetail: input.imageDetail ?? null,
          reasoningEffort: input.reasoningEffort ?? null,
          promptVersion: input.promptVersion,
          schemaVersion: input.schemaVersion,
          startedAt: timestamp,
        })
        .returning()
        .get();
    }, { behavior: "immediate" });
  }

  recordResponseReceived(
    attemptId: string,
    metadata: Pick<CompletePassAttemptInput, "apiRequestId" | "apiStatusCode"> = {},
  ): PassAttemptRow {
    const updated = this.db
      .update(passAttempts)
      .set({
        responseReceivedAt: this.clock(),
        apiRequestId: metadata.apiRequestId ?? null,
        apiStatusCode: metadata.apiStatusCode ?? null,
      })
      .where(and(eq(passAttempts.id, attemptId), eq(passAttempts.state, "running")))
      .returning()
      .get();
    if (!updated) {
      throw new PersistenceConflictError(`Pass attempt ${attemptId} is not running`);
    }
    return updated;
  }

  completePassAttempt(attemptId: string, input: CompletePassAttemptInput): PassAttemptRow {
    if (!Number.isInteger(input.durationMs) || input.durationMs < 0) {
      throw new PersistenceValidationError("Attempt duration must be a non-negative integer");
    }
    const timestamp = this.clock();

    return this.db.transaction((tx) => {
      const attempt = tx
        .select()
        .from(passAttempts)
        .where(eq(passAttempts.id, attemptId))
        .get();
      if (!attempt) throw new RecordNotFoundError(`Pass attempt ${attemptId} was not found`);
      if (attempt.state !== "running") {
        throw new InvalidStateTransitionError("attempt", attempt.state, "completed");
      }
      const pass = tx
        .select()
        .from(analysisPasses)
        .where(eq(analysisPasses.id, attempt.passId))
        .get();
      if (!pass || pass.state !== "running") {
        throw new PersistenceConflictError(`Analysis pass ${attempt.passId} is not running`);
      }

      const completed = tx
        .update(passAttempts)
        .set({
          state: "completed",
          validatedOutput: input.validatedOutput,
          responseReceivedAt: input.responseReceivedAt ?? attempt.responseReceivedAt ?? timestamp,
          completedAt: timestamp,
          durationMs: input.durationMs,
          apiStatusCode: input.apiStatusCode ?? null,
          apiRequestId: input.apiRequestId ?? null,
          inputTokens: input.usage?.inputTokens ?? null,
          cachedInputTokens: input.usage?.cachedInputTokens ?? null,
          cacheWriteInputTokens: input.usage?.cacheWriteInputTokens ?? null,
          outputTokens: input.usage?.outputTokens ?? null,
          reasoningOutputTokens: input.usage?.reasoningOutputTokens ?? null,
          totalTokens: input.usage?.totalTokens ?? null,
          estimatedCostMicroUsd: input.usage?.estimatedCostMicroUsd ?? null,
          pricingSnapshot: input.usage?.pricingSnapshot ?? null,
        })
        .where(and(eq(passAttempts.id, attemptId), eq(passAttempts.state, "running")))
        .returning()
        .get();
      if (!completed) {
        throw new PersistenceConflictError(`Pass attempt ${attemptId} changed concurrently`);
      }

      tx.update(analysisPasses)
        .set({
          state: "completed",
          updatedAt: timestamp,
          completedAt: timestamp,
          safeErrorCode: null,
          safeErrorMessage: null,
        })
        .where(and(eq(analysisPasses.id, pass.id), eq(analysisPasses.state, "running")))
        .run();
      return completed;
    }, { behavior: "immediate" });
  }

  failPassAttempt(attemptId: string, input: FailPassAttemptInput): PassAttemptRow {
    if (!Number.isInteger(input.durationMs) || input.durationMs < 0) {
      throw new PersistenceValidationError("Attempt duration must be a non-negative integer");
    }
    const attemptState = input.state ?? "failed";
    const passState: Extract<AnalysisPassState, "failed" | "cancelled" | "interrupted"> =
      attemptState;
    const timestamp = this.clock();

    return this.db.transaction((tx) => {
      const attempt = tx
        .select()
        .from(passAttempts)
        .where(eq(passAttempts.id, attemptId))
        .get();
      if (!attempt) throw new RecordNotFoundError(`Pass attempt ${attemptId} was not found`);
      if (attempt.state !== "running") {
        throw new InvalidStateTransitionError("attempt", attempt.state, attemptState);
      }

      const failed = tx
        .update(passAttempts)
        .set({
          state: attemptState,
          safeErrorCode: input.failure.code,
          safeErrorMessage: input.failure.message,
          responseReceivedAt: input.responseReceivedAt ?? attempt.responseReceivedAt,
          completedAt: timestamp,
          durationMs: input.durationMs,
          apiStatusCode: input.apiStatusCode ?? null,
          apiRequestId: input.apiRequestId ?? null,
          inputTokens: input.usage?.inputTokens ?? null,
          cachedInputTokens: input.usage?.cachedInputTokens ?? null,
          cacheWriteInputTokens: input.usage?.cacheWriteInputTokens ?? null,
          outputTokens: input.usage?.outputTokens ?? null,
          reasoningOutputTokens: input.usage?.reasoningOutputTokens ?? null,
          totalTokens: input.usage?.totalTokens ?? null,
          estimatedCostMicroUsd: input.usage?.estimatedCostMicroUsd ?? null,
          pricingSnapshot: input.usage?.pricingSnapshot ?? null,
        })
        .where(and(eq(passAttempts.id, attemptId), eq(passAttempts.state, "running")))
        .returning()
        .get();
      if (!failed) {
        throw new PersistenceConflictError(`Pass attempt ${attemptId} changed concurrently`);
      }

      tx.update(analysisPasses)
        .set({
          state: passState,
          safeErrorCode: input.failure.code,
          safeErrorMessage: input.failure.message,
          updatedAt: timestamp,
          completedAt: timestamp,
        })
        .where(and(eq(analysisPasses.id, attempt.passId), eq(analysisPasses.state, "running")))
        .run();
      return failed;
    }, { behavior: "immediate" });
  }

  retryPass(passId: string): AnalysisRunWithPasses {
    const pass = this.requirePass(passId);
    if (pass.state !== "failed" && pass.state !== "interrupted") {
      throw new InvalidStateTransitionError("pass", pass.state, "pending");
    }
    const run = this.requireById(pass.runId);
    if (run.state !== "failed" && run.state !== "interrupted" && run.state !== "running") {
      throw new InvalidStateTransitionError("run", run.state, "queued");
    }
    const timestamp = this.clock();

    this.db.transaction((tx) => {
      if (run.state !== "running") {
        const review = tx
          .select({ lifecycle: reviews.lifecycle })
          .from(reviews)
          .where(eq(reviews.id, run.reviewId))
          .get();
        if (!review || review.lifecycle !== "active") {
          throw new PersistenceConflictError(
            "An analysis run can only be retried for an active review",
          );
        }

        const revisionAssets = tx
          .select({ retentionState: imageAssets.retentionState })
          .from(reviewImageRevisionItems)
          .innerJoin(imageAssets, eq(reviewImageRevisionItems.imageAssetId, imageAssets.id))
          .where(eq(reviewImageRevisionItems.revisionId, run.imageRevisionId))
          .all();
        if (
          revisionAssets.length === 0 ||
          revisionAssets.some((asset) => asset.retentionState !== "retained")
        ) {
          throw new PersistenceConflictError(
            "Every image required by a retried analysis run must still be locally retained",
          );
        }
      }

      tx.update(analysisPasses)
        .set({
          state: "pending",
          safeErrorCode: null,
          safeErrorMessage: null,
          completedAt: null,
          updatedAt: timestamp,
        })
        .where(and(eq(analysisPasses.id, passId), eq(analysisPasses.state, pass.state)))
        .run();
      if (run.state !== "running") {
        tx.update(analysisRuns)
          .set({
            state: "queued",
            cancelRequested: false,
            leaseOwner: null,
            leaseExpiresAt: null,
            safeErrorCode: null,
            safeErrorMessage: null,
            completedAt: null,
            updatedAt: timestamp,
          })
          .where(and(eq(analysisRuns.id, run.id), eq(analysisRuns.state, run.state)))
          .run();
      }
    }, { behavior: "immediate" });
    return this.requireWithPasses(run.id);
  }

  getAttempt(attemptId: string): PassAttemptRow | null {
    return (
      this.db.select().from(passAttempts).where(eq(passAttempts.id, attemptId)).get() ?? null
    );
  }

  listAttempts(passId: string): PassAttemptRow[] {
    return this.db
      .select()
      .from(passAttempts)
      .where(eq(passAttempts.passId, passId))
      .orderBy(asc(passAttempts.attemptNumber))
      .all();
  }
}
