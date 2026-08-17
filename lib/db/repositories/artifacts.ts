import { and, asc, eq, max } from "drizzle-orm";

import type { AppDatabase } from "../client";
import {
  analysisPasses,
  analysisRuns,
  criteriaAnalyses,
  designAnalyses,
  type CriteriaAnalysisRow,
  type DesignAnalysisRow,
  type JsonSnapshot,
} from "../schema";
import {
  PersistenceConflictError,
  PersistenceValidationError,
  RecordNotFoundError,
} from "./errors";
import {
  type Clock,
  type IdFactory,
  type RepositoryDependencies,
  systemClock,
  systemIdFactory,
} from "./shared";

export interface FinaliseArtifactInput {
  id?: string;
  runId: string;
  schemaVersion: string;
  promptSetVersion: string;
  passProvenance: JsonSnapshot;
  artifact: unknown;
}

export interface FinaliseCriteriaArtifactInput extends FinaliseArtifactInput {
  criteriaSnapshot: JsonSnapshot;
}

function assertRunCanBeFinalised(
  run: typeof analysisRuns.$inferSelect,
  passes: Array<typeof analysisPasses.$inferSelect>,
  expectedKind: "design" | "criteria",
): void {
  if (run.kind !== expectedKind) {
    throw new PersistenceValidationError(
      `Cannot create a ${expectedKind} artifact from a ${run.kind} run`,
    );
  }
  if (run.state !== "running") {
    throw new PersistenceConflictError(
      `Analysis run ${run.id} must be running before it can be finalised`,
    );
  }
  if (run.cancelRequested) {
    throw new PersistenceConflictError(
      `Analysis run ${run.id} has a pending cancellation request and cannot be finalised`,
    );
  }
  if (passes.length === 0 || passes.some((pass) => !["completed", "skipped"].includes(pass.state))) {
    throw new PersistenceConflictError(
      `Every pass in analysis run ${run.id} must be completed or explicitly skipped`,
    );
  }
}

export class AnalysisArtifactRepository {
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(
    private readonly db: AppDatabase,
    dependencies: RepositoryDependencies = {},
  ) {
    this.clock = dependencies.clock ?? systemClock;
    this.idFactory = dependencies.idFactory ?? systemIdFactory;
  }

  finaliseDesignRun(input: FinaliseArtifactInput): DesignAnalysisRow {
    const alreadyFinalised = this.db
      .select()
      .from(designAnalyses)
      .where(eq(designAnalyses.sourceRunId, input.runId))
      .get();
    if (alreadyFinalised) return alreadyFinalised;

    return this.db.transaction((tx) => {
      const run = tx.select().from(analysisRuns).where(eq(analysisRuns.id, input.runId)).get();
      if (!run) throw new RecordNotFoundError(`Analysis run ${input.runId} was not found`);
      const passes = tx
        .select()
        .from(analysisPasses)
        .where(eq(analysisPasses.runId, run.id))
        .all();
      assertRunCanBeFinalised(run, passes, "design");

      const maximum = tx
        .select({ value: max(designAnalyses.version) })
        .from(designAnalyses)
        .where(eq(designAnalyses.reviewId, run.reviewId))
        .get();
      const version = (maximum?.value ?? 0) + 1;
      const timestamp = this.clock();

      const artifact = tx
        .insert(designAnalyses)
        .values({
          id: input.id ?? this.idFactory(),
          sourceRunId: run.id,
          reviewId: run.reviewId,
          version,
          schemaVersion: input.schemaVersion,
          promptSetVersion: input.promptSetVersion,
          inputSnapshot: run.inputSnapshot,
          passProvenance: input.passProvenance,
          artifact: input.artifact,
          createdAt: timestamp,
        })
        .returning()
        .get();

      const result = tx
        .update(analysisRuns)
        .set({
          state: "completed",
          updatedAt: timestamp,
          completedAt: timestamp,
          leaseOwner: null,
          leaseExpiresAt: null,
          safeErrorCode: null,
          safeErrorMessage: null,
        })
        .where(and(eq(analysisRuns.id, run.id), eq(analysisRuns.state, "running")))
        .run();
      if (result.changes !== 1) {
        throw new PersistenceConflictError(`Analysis run ${run.id} changed concurrently`);
      }
      return artifact;
    }, { behavior: "immediate" });
  }

  finaliseCriteriaRun(input: FinaliseCriteriaArtifactInput): CriteriaAnalysisRow {
    const alreadyFinalised = this.db
      .select()
      .from(criteriaAnalyses)
      .where(eq(criteriaAnalyses.sourceRunId, input.runId))
      .get();
    if (alreadyFinalised) return alreadyFinalised;

    return this.db.transaction((tx) => {
      const run = tx.select().from(analysisRuns).where(eq(analysisRuns.id, input.runId)).get();
      if (!run) throw new RecordNotFoundError(`Analysis run ${input.runId} was not found`);
      const passes = tx
        .select()
        .from(analysisPasses)
        .where(eq(analysisPasses.runId, run.id))
        .all();
      assertRunCanBeFinalised(run, passes, "criteria");
      if (!run.selectedDesignAnalysisId) {
        throw new PersistenceValidationError(
          `Criteria Analysis run ${run.id} has no selected Design Analysis`,
        );
      }
      const designArtifact = tx
        .select({ reviewId: designAnalyses.reviewId })
        .from(designAnalyses)
        .where(eq(designAnalyses.id, run.selectedDesignAnalysisId))
        .get();
      if (!designArtifact || designArtifact.reviewId !== run.reviewId) {
        throw new PersistenceValidationError(
          `Criteria Analysis run ${run.id} references an invalid Design Analysis`,
        );
      }

      const maximum = tx
        .select({ value: max(criteriaAnalyses.version) })
        .from(criteriaAnalyses)
        .where(eq(criteriaAnalyses.reviewId, run.reviewId))
        .get();
      const version = (maximum?.value ?? 0) + 1;
      const timestamp = this.clock();

      const artifact = tx
        .insert(criteriaAnalyses)
        .values({
          id: input.id ?? this.idFactory(),
          sourceRunId: run.id,
          reviewId: run.reviewId,
          version,
          designAnalysisId: run.selectedDesignAnalysisId,
          schemaVersion: input.schemaVersion,
          promptSetVersion: input.promptSetVersion,
          criteriaSnapshot: input.criteriaSnapshot,
          inputSnapshot: run.inputSnapshot,
          passProvenance: input.passProvenance,
          artifact: input.artifact,
          createdAt: timestamp,
        })
        .returning()
        .get();

      const result = tx
        .update(analysisRuns)
        .set({
          state: "completed",
          updatedAt: timestamp,
          completedAt: timestamp,
          leaseOwner: null,
          leaseExpiresAt: null,
          safeErrorCode: null,
          safeErrorMessage: null,
        })
        .where(and(eq(analysisRuns.id, run.id), eq(analysisRuns.state, "running")))
        .run();
      if (result.changes !== 1) {
        throw new PersistenceConflictError(`Analysis run ${run.id} changed concurrently`);
      }
      return artifact;
    }, { behavior: "immediate" });
  }

  getDesignAnalysis(analysisId: string): DesignAnalysisRow | null {
    return (
      this.db.select().from(designAnalyses).where(eq(designAnalyses.id, analysisId)).get() ??
      null
    );
  }

  getCriteriaAnalysis(analysisId: string): CriteriaAnalysisRow | null {
    return (
      this.db
        .select()
        .from(criteriaAnalyses)
        .where(eq(criteriaAnalyses.id, analysisId))
        .get() ?? null
    );
  }

  getDesignAnalysisForRun(runId: string): DesignAnalysisRow | null {
    return (
      this.db.select().from(designAnalyses).where(eq(designAnalyses.sourceRunId, runId)).get() ??
      null
    );
  }

  getCriteriaAnalysisForRun(runId: string): CriteriaAnalysisRow | null {
    return (
      this.db
        .select()
        .from(criteriaAnalyses)
        .where(eq(criteriaAnalyses.sourceRunId, runId))
        .get() ?? null
    );
  }

  listDesignAnalyses(reviewId: string): DesignAnalysisRow[] {
    return this.db
      .select()
      .from(designAnalyses)
      .where(eq(designAnalyses.reviewId, reviewId))
      .orderBy(asc(designAnalyses.version))
      .all();
  }

  listCriteriaAnalyses(reviewId: string): CriteriaAnalysisRow[] {
    return this.db
      .select()
      .from(criteriaAnalyses)
      .where(eq(criteriaAnalyses.reviewId, reviewId))
      .orderBy(asc(criteriaAnalyses.version))
      .all();
  }
}
