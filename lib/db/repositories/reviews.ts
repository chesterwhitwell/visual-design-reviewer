import { and, asc, desc, eq, inArray, lte, max } from "drizzle-orm";

import type { AppDatabase } from "../client";
import {
  analysisRuns,
  criteria,
  criteriaAnalyses,
  designAnalyses,
  imageAssets,
  judgementStatements,
  reviewAreaSelections,
  reviewImageRevisionItems,
  reviewImageRevisions,
  reviews,
  type CriterionRow,
  type ImageAssetRow,
  type JudgementStatementRow,
  type ReviewAreaSelectionRow,
  type ReviewImageRevisionRow,
  type ReviewRow,
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

export type ReviewLifecycle = "active" | "closed";
export type ReviewMode = "off" | "review" | "focus";
export type SupportedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface CreateReviewInput {
  id?: string;
  title?: string | null;
  context?: string | null;
}

export interface UpdateReviewInput {
  title?: string | null;
  context?: string | null;
}

export interface CreateImageAssetInput {
  id?: string;
  reviewId: string;
  displayName?: string | null;
  originalFilename?: string | null;
  contentDigest: string;
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  byteSize: number;
  storageLocator?: string | null;
  thumbnailStorageLocator?: string | null;
  encryptionVersion?: number | null;
  expiresAt?: string | null;
}

export interface ImageRevisionItemInput {
  imageAssetId: string;
  imageLabel?: string;
  analysisRole?: "final_work" | "concept_development";
}

export interface ReviewImageRevisionWithItems extends ReviewImageRevisionRow {
  images: Array<{
    position: number;
    imageLabel: string;
    analysisRole: "final_work" | "concept_development";
    asset: ImageAssetRow;
  }>;
}

export interface ReviewAreaSelectionInput {
  areaId: string;
  taxonomyVersion: string;
  areaLabel: string;
  mode: ReviewMode;
  position: number;
}

export interface JudgementStatementInput {
  id?: string;
  label: string;
  description: string;
  position: number;
}

export interface CriterionInput {
  id?: string;
  title: string;
  statement: string;
  assessorNote?: string | null;
  position: number;
  judgementStatements?: JudgementStatementInput[];
}

export interface CriterionWithStatements extends CriterionRow {
  judgementStatements: JudgementStatementRow[];
}

export interface ReviewAggregate {
  review: ReviewRow;
  imageRevision: ReviewImageRevisionWithItems | null;
  reviewAreas: ReviewAreaSelectionRow[];
  criteria: CriterionWithStatements[];
}

function assertNonNegativePositions(
  records: ReadonlyArray<{ position: number }>,
  label: string,
): void {
  const positions = records.map((record) => record.position);
  if (positions.some((position) => !Number.isInteger(position) || position < 0)) {
    throw new PersistenceValidationError(`${label} positions must be non-negative integers`);
  }
  if (new Set(positions).size !== positions.length) {
    throw new PersistenceValidationError(`${label} positions must be unique`);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new PersistenceValidationError(`${label} must be unique`);
  }
}

export class ReviewRepository {
  private readonly clock: Clock;
  private readonly idFactory: IdFactory;

  constructor(
    private readonly db: AppDatabase,
    dependencies: RepositoryDependencies = {},
  ) {
    this.clock = dependencies.clock ?? systemClock;
    this.idFactory = dependencies.idFactory ?? systemIdFactory;
  }

  create(input: CreateReviewInput = {}): ReviewRow {
    const timestamp = this.clock();
    return this.db
      .insert(reviews)
      .values({
        id: input.id ?? this.idFactory(),
        title: input.title ?? null,
        context: input.context ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
      .get();
  }

  getById(reviewId: string): ReviewRow | null {
    return this.db.select().from(reviews).where(eq(reviews.id, reviewId)).get() ?? null;
  }

  requireById(reviewId: string): ReviewRow {
    const review = this.getById(reviewId);
    if (!review) {
      throw new RecordNotFoundError(`Review ${reviewId} was not found`);
    }
    return review;
  }

  list(): ReviewRow[] {
    return this.db.select().from(reviews).orderBy(desc(reviews.updatedAt)).all();
  }

  update(reviewId: string, input: UpdateReviewInput): ReviewRow {
    const values: Partial<typeof reviews.$inferInsert> = { updatedAt: this.clock() };
    if (Object.hasOwn(input, "title")) values.title = input.title ?? null;
    if (Object.hasOwn(input, "context")) values.context = input.context ?? null;

    const updated = this.db
      .update(reviews)
      .set(values)
      .where(eq(reviews.id, reviewId))
      .returning()
      .get();

    if (!updated) throw new RecordNotFoundError(`Review ${reviewId} was not found`);
    return updated;
  }

  setLifecycle(reviewId: string, lifecycle: ReviewLifecycle): ReviewRow {
    const timestamp = this.clock();
    const updated = this.db
      .update(reviews)
      .set({
        lifecycle,
        closedAt: lifecycle === "closed" ? timestamp : null,
        updatedAt: timestamp,
      })
      .where(eq(reviews.id, reviewId))
      .returning()
      .get();

    if (!updated) throw new RecordNotFoundError(`Review ${reviewId} was not found`);
    return updated;
  }

  /**
   * Starts an irreversible review deletion under the same SQLite write lock
   * used by run enqueue/retry and image purge. Closing the review prevents any
   * later analysis from acquiring its retained files while deletion proceeds.
   */
  beginDeletion(reviewId: string): ReviewRow {
    return this.db.transaction(
      (tx) => {
        const review = tx.select().from(reviews).where(eq(reviews.id, reviewId)).get();
        if (!review) throw new RecordNotFoundError(`Review ${reviewId} was not found`);

        const activeRun = tx
          .select({ id: analysisRuns.id })
          .from(analysisRuns)
          .where(
            and(
              eq(analysisRuns.reviewId, reviewId),
              inArray(analysisRuns.state, ["queued", "running"]),
            ),
          )
          .limit(1)
          .get();
        if (activeRun) {
          throw new PersistenceConflictError(
            "The review cannot be deleted while an analysis is queued or running",
          );
        }

        if (review.lifecycle === "closed") return review;
        const timestamp = this.clock();
        return tx
          .update(reviews)
          .set({ lifecycle: "closed", closedAt: timestamp, updatedAt: timestamp })
          .where(eq(reviews.id, reviewId))
          .returning()
          .get();
      },
      { behavior: "immediate" },
    );
  }

  /**
   * Deletes every database record owned by a closed review after its encrypted
   * blobs have been purged. Restrictive artifact and revision links are removed
   * in dependency order, all within one transaction.
   */
  deleteReview(reviewId: string): ReviewRow {
    return this.db.transaction(
      (tx) => {
        const review = tx.select().from(reviews).where(eq(reviews.id, reviewId)).get();
        if (!review) throw new RecordNotFoundError(`Review ${reviewId} was not found`);
        if (review.lifecycle !== "closed") {
          throw new PersistenceConflictError(
            "The review must be closed before it can be deleted",
          );
        }

        const activeRun = tx
          .select({ id: analysisRuns.id })
          .from(analysisRuns)
          .where(
            and(
              eq(analysisRuns.reviewId, reviewId),
              inArray(analysisRuns.state, ["queued", "running"]),
            ),
          )
          .limit(1)
          .get();
        if (activeRun) {
          throw new PersistenceConflictError(
            "The review cannot be deleted while an analysis is queued or running",
          );
        }

        const remainingImages = tx
          .select({
            id: imageAssets.id,
            retentionState: imageAssets.retentionState,
            storageLocator: imageAssets.storageLocator,
            thumbnailStorageLocator: imageAssets.thumbnailStorageLocator,
          })
          .from(imageAssets)
          .where(eq(imageAssets.reviewId, reviewId))
          .all();
        if (
          remainingImages.some(
            (image) =>
              image.retentionState !== "purged" ||
              image.storageLocator !== null ||
              image.thumbnailStorageLocator !== null,
          )
        ) {
          throw new PersistenceConflictError(
            "Every retained review image must be purged before database deletion",
          );
        }

        tx.delete(criteriaAnalyses).where(eq(criteriaAnalyses.reviewId, reviewId)).run();
        tx.delete(analysisRuns)
          .where(
            and(eq(analysisRuns.reviewId, reviewId), eq(analysisRuns.kind, "criteria")),
          )
          .run();
        tx.delete(designAnalyses).where(eq(designAnalyses.reviewId, reviewId)).run();
        tx.delete(analysisRuns).where(eq(analysisRuns.reviewId, reviewId)).run();
        tx.delete(reviewImageRevisions)
          .where(eq(reviewImageRevisions.reviewId, reviewId))
          .run();
        tx.delete(imageAssets).where(eq(imageAssets.reviewId, reviewId)).run();
        tx.delete(reviews).where(eq(reviews.id, reviewId)).run();
        return review;
      },
      { behavior: "immediate" },
    );
  }

  createImageAsset(input: CreateImageAssetInput): ImageAssetRow {
    this.requireById(input.reviewId);
    if (!input.contentDigest) {
      throw new PersistenceValidationError("An image content digest is required");
    }

    return this.db
      .insert(imageAssets)
      .values({
        id: input.id ?? this.idFactory(),
        reviewId: input.reviewId,
        displayName: input.displayName ?? null,
        originalFilename: input.originalFilename ?? null,
        contentDigest: input.contentDigest,
        mimeType: input.mimeType,
        width: input.width,
        height: input.height,
        byteSize: input.byteSize,
        storageLocator: input.storageLocator ?? null,
        thumbnailStorageLocator: input.thumbnailStorageLocator ?? null,
        encryptionVersion: input.encryptionVersion ?? null,
        expiresAt: input.expiresAt ?? null,
        createdAt: this.clock(),
      })
      .returning()
      .get();
  }

  getImageAsset(imageAssetId: string): ImageAssetRow | null {
    return (
      this.db.select().from(imageAssets).where(eq(imageAssets.id, imageAssetId)).get() ?? null
    );
  }

  listImageAssets(reviewId: string): ImageAssetRow[] {
    return this.db
      .select()
      .from(imageAssets)
      .where(eq(imageAssets.reviewId, reviewId))
      .orderBy(asc(imageAssets.createdAt))
      .all();
  }

  /**
   * Atomically reserves an image for deletion. Returning null means the image
   * is already purged or is still referenced by a queued/running analysis.
   *
   * BEGIN IMMEDIATE is important here: analysis-run creation uses the same
   * transaction mode while checking that every revision asset is retained, so
   * a run enqueue and a purge claim cannot both win the race.
   */
  tryClaimImageForPurge(imageAssetId: string): ImageAssetRow | null {
    return this.db.transaction(
      (tx) => {
        const existing = tx
          .select()
          .from(imageAssets)
          .where(eq(imageAssets.id, imageAssetId))
          .get();
        if (!existing) {
          throw new RecordNotFoundError(`Image asset ${imageAssetId} was not found`);
        }
        if (existing.retentionState === "purged") return null;

        const activeRun = tx
          .select({ id: analysisRuns.id })
          .from(analysisRuns)
          .innerJoin(
            reviewImageRevisionItems,
            eq(analysisRuns.imageRevisionId, reviewImageRevisionItems.revisionId),
          )
          .where(
            and(
              eq(reviewImageRevisionItems.imageAssetId, imageAssetId),
              inArray(analysisRuns.state, ["queued", "running"]),
            ),
          )
          .limit(1)
          .get();
        if (activeRun) return null;
        if (existing.retentionState === "purge_pending") return existing;

        return (
          tx
            .update(imageAssets)
            .set({ retentionState: "purge_pending", purgeRequestedAt: this.clock() })
            .where(
              and(
                eq(imageAssets.id, imageAssetId),
                eq(imageAssets.retentionState, "retained"),
              ),
            )
            .returning()
            .get() ?? null
        );
      },
      { behavior: "immediate" },
    );
  }

  markImagePurgePending(imageAssetId: string): ImageAssetRow {
    const claimed = this.tryClaimImageForPurge(imageAssetId);
    if (claimed) return claimed;

    const existing = this.getImageAsset(imageAssetId);
    if (!existing) {
      throw new RecordNotFoundError(`Image asset ${imageAssetId} was not found`);
    }
    if (existing.retentionState === "purged") {
      throw new PersistenceConflictError(`Image asset ${imageAssetId} has already been purged`);
    }
    throw new PersistenceConflictError(
      `Image asset ${imageAssetId} is required by an active analysis run`,
    );
  }

  markImagePurged(imageAssetId: string): ImageAssetRow {
    return this.db.transaction(
      (tx) => {
        const existing = tx
          .select()
          .from(imageAssets)
          .where(eq(imageAssets.id, imageAssetId))
          .get();
        if (!existing) {
          throw new RecordNotFoundError(`Image asset ${imageAssetId} was not found`);
        }
        if (existing.retentionState === "purged") return existing;

        const activeRun = tx
          .select({ id: analysisRuns.id })
          .from(analysisRuns)
          .innerJoin(
            reviewImageRevisionItems,
            eq(analysisRuns.imageRevisionId, reviewImageRevisionItems.revisionId),
          )
          .where(
            and(
              eq(reviewImageRevisionItems.imageAssetId, imageAssetId),
              inArray(analysisRuns.state, ["queued", "running"]),
            ),
          )
          .limit(1)
          .get();
        if (activeRun) {
          throw new PersistenceConflictError(
            `Image asset ${imageAssetId} is required by active analysis run ${activeRun.id}`,
          );
        }

        const timestamp = this.clock();
        return tx
          .update(imageAssets)
          .set({
            retentionState: "purged",
            storageLocator: null,
            thumbnailStorageLocator: null,
            purgeRequestedAt: existing.purgeRequestedAt ?? timestamp,
            purgedAt: timestamp,
          })
          .where(eq(imageAssets.id, imageAssetId))
          .returning()
          .get();
      },
      { behavior: "immediate" },
    );
  }

  listExpiredRetainedImages(at = this.clock(), limit = 100): ImageAssetRow[] {
    return this.db
      .select()
      .from(imageAssets)
      .where(
        and(eq(imageAssets.retentionState, "retained"), lte(imageAssets.expiresAt, at)),
      )
      .orderBy(asc(imageAssets.expiresAt))
      .limit(limit)
      .all();
  }

  listPurgePendingImages(limit = 100): ImageAssetRow[] {
    return this.db
      .select()
      .from(imageAssets)
      .where(eq(imageAssets.retentionState, "purge_pending"))
      .orderBy(asc(imageAssets.purgeRequestedAt), asc(imageAssets.createdAt))
      .limit(limit)
      .all();
  }

  createImageRevision(
    reviewId: string,
    items: readonly ImageRevisionItemInput[],
    revisionId = this.idFactory(),
  ): ReviewImageRevisionWithItems {
    this.requireById(reviewId);
    assertUnique(
      items.map((item) => item.imageAssetId),
      "Image revision asset IDs",
    );

    const timestamp = this.clock();
    this.db.transaction((tx) => {
      if (items.length > 0) {
        const assets = tx
          .select({ id: imageAssets.id, reviewId: imageAssets.reviewId })
          .from(imageAssets)
          .where(inArray(imageAssets.id, items.map((item) => item.imageAssetId)))
          .all();
        const matching = assets.filter((asset) => asset.reviewId === reviewId);
        if (matching.length !== items.length) {
          throw new PersistenceValidationError(
            "Every image in a revision must exist and belong to the review",
          );
        }
      }

      const maximum = tx
        .select({ value: max(reviewImageRevisions.version) })
        .from(reviewImageRevisions)
        .where(eq(reviewImageRevisions.reviewId, reviewId))
        .get();
      const version = (maximum?.value ?? 0) + 1;

      tx.insert(reviewImageRevisions)
        .values({ id: revisionId, reviewId, version, createdAt: timestamp })
        .run();

      if (items.length > 0) {
        tx.insert(reviewImageRevisionItems)
          .values(
            items.map((item, position) => ({
              revisionId,
              imageAssetId: item.imageAssetId,
              position,
              imageLabel: item.imageLabel ?? `image_${position + 1}`,
              analysisRole: item.analysisRole ?? "final_work",
            })),
          )
          .run();
      }
    }, { behavior: "immediate" });

    return this.requireImageRevision(revisionId);
  }

  getImageRevision(revisionId: string): ReviewImageRevisionWithItems | null {
    const revision = this.db
      .select()
      .from(reviewImageRevisions)
      .where(eq(reviewImageRevisions.id, revisionId))
      .get();
    if (!revision) return null;

    const images = this.db
      .select({
        position: reviewImageRevisionItems.position,
        imageLabel: reviewImageRevisionItems.imageLabel,
        analysisRole: reviewImageRevisionItems.analysisRole,
        asset: imageAssets,
      })
      .from(reviewImageRevisionItems)
      .innerJoin(imageAssets, eq(reviewImageRevisionItems.imageAssetId, imageAssets.id))
      .where(eq(reviewImageRevisionItems.revisionId, revisionId))
      .orderBy(asc(reviewImageRevisionItems.position))
      .all();

    return { ...revision, images };
  }

  requireImageRevision(revisionId: string): ReviewImageRevisionWithItems {
    const revision = this.getImageRevision(revisionId);
    if (!revision) {
      throw new RecordNotFoundError(`Image revision ${revisionId} was not found`);
    }
    return revision;
  }

  getLatestImageRevision(reviewId: string): ReviewImageRevisionWithItems | null {
    const revision = this.db
      .select({ id: reviewImageRevisions.id })
      .from(reviewImageRevisions)
      .where(eq(reviewImageRevisions.reviewId, reviewId))
      .orderBy(desc(reviewImageRevisions.version))
      .limit(1)
      .get();
    return revision ? this.requireImageRevision(revision.id) : null;
  }

  replaceReviewAreaSelections(
    reviewId: string,
    selections: readonly ReviewAreaSelectionInput[],
  ): ReviewAreaSelectionRow[] {
    this.requireById(reviewId);
    assertUnique(
      selections.map((selection) => selection.areaId),
      "Review area IDs",
    );
    assertNonNegativePositions(selections, "Review area");
    const timestamp = this.clock();

    this.db.transaction((tx) => {
      tx.delete(reviewAreaSelections)
        .where(eq(reviewAreaSelections.reviewId, reviewId))
        .run();
      if (selections.length > 0) {
        tx.insert(reviewAreaSelections)
          .values(
            selections.map((selection) => ({
              reviewId,
              ...selection,
              updatedAt: timestamp,
            })),
          )
          .run();
      }
      tx.update(reviews).set({ updatedAt: timestamp }).where(eq(reviews.id, reviewId)).run();
    });

    return this.listReviewAreaSelections(reviewId);
  }

  listReviewAreaSelections(reviewId: string): ReviewAreaSelectionRow[] {
    return this.db
      .select()
      .from(reviewAreaSelections)
      .where(eq(reviewAreaSelections.reviewId, reviewId))
      .orderBy(asc(reviewAreaSelections.position))
      .all();
  }

  createCriterion(reviewId: string, input: CriterionInput): CriterionWithStatements {
    this.requireById(reviewId);
    assertNonNegativePositions([input], "Criterion");
    assertNonNegativePositions(input.judgementStatements ?? [], "Judgement statement");
    const criterionId = input.id ?? this.idFactory();
    const timestamp = this.clock();

    this.db.transaction((tx) => {
      tx.insert(criteria)
        .values({
          id: criterionId,
          reviewId,
          title: input.title,
          statement: input.statement,
          assessorNote: input.assessorNote ?? null,
          position: input.position,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
      if (input.judgementStatements?.length) {
        tx.insert(judgementStatements)
          .values(
            input.judgementStatements.map((statement) => ({
              id: statement.id ?? this.idFactory(),
              criterionId,
              label: statement.label,
              description: statement.description,
              position: statement.position,
              createdAt: timestamp,
              updatedAt: timestamp,
            })),
          )
          .run();
      }
      tx.update(reviews).set({ updatedAt: timestamp }).where(eq(reviews.id, reviewId)).run();
    });

    return this.requireCriterion(criterionId);
  }

  updateCriterion(
    criterionId: string,
    input: Omit<CriterionInput, "id" | "judgementStatements">,
  ): CriterionWithStatements {
    const timestamp = this.clock();
    const updated = this.db
      .update(criteria)
      .set({
        title: input.title,
        statement: input.statement,
        assessorNote: input.assessorNote ?? null,
        position: input.position,
        updatedAt: timestamp,
      })
      .where(eq(criteria.id, criterionId))
      .returning()
      .get();
    if (!updated) throw new RecordNotFoundError(`Criterion ${criterionId} was not found`);
    this.db
      .update(reviews)
      .set({ updatedAt: timestamp })
      .where(eq(reviews.id, updated.reviewId))
      .run();
    return this.requireCriterion(criterionId);
  }

  replaceJudgementStatements(
    criterionId: string,
    statements: readonly JudgementStatementInput[],
  ): JudgementStatementRow[] {
    const criterion = this.db
      .select()
      .from(criteria)
      .where(eq(criteria.id, criterionId))
      .get();
    if (!criterion) throw new RecordNotFoundError(`Criterion ${criterionId} was not found`);
    assertNonNegativePositions(statements, "Judgement statement");
    const ids = statements.map((statement) => statement.id).filter((id): id is string => !!id);
    assertUnique(ids, "Judgement statement IDs");
    const timestamp = this.clock();

    this.db.transaction((tx) => {
      tx.delete(judgementStatements)
        .where(eq(judgementStatements.criterionId, criterionId))
        .run();
      if (statements.length > 0) {
        tx.insert(judgementStatements)
          .values(
            statements.map((statement) => ({
              id: statement.id ?? this.idFactory(),
              criterionId,
              label: statement.label,
              description: statement.description,
              position: statement.position,
              createdAt: timestamp,
              updatedAt: timestamp,
            })),
          )
          .run();
      }
      tx.update(criteria)
        .set({ updatedAt: timestamp })
        .where(eq(criteria.id, criterionId))
        .run();
      tx.update(reviews)
        .set({ updatedAt: timestamp })
        .where(eq(reviews.id, criterion.reviewId))
        .run();
    });

    return this.listJudgementStatements(criterionId);
  }

  deleteCriterion(criterionId: string): boolean {
    const criterion = this.db
      .select({ reviewId: criteria.reviewId })
      .from(criteria)
      .where(eq(criteria.id, criterionId))
      .get();
    if (!criterion) return false;
    const timestamp = this.clock();
    this.db.transaction((tx) => {
      tx.delete(criteria).where(eq(criteria.id, criterionId)).run();
      tx.update(reviews)
        .set({ updatedAt: timestamp })
        .where(eq(reviews.id, criterion.reviewId))
        .run();
    });
    return true;
  }

  replaceCriteria(reviewId: string, inputs: readonly CriterionInput[]): CriterionWithStatements[] {
    this.requireById(reviewId);
    assertNonNegativePositions(inputs, "Criterion");
    const suppliedCriterionIds = inputs.map((input) => input.id).filter((id): id is string => !!id);
    assertUnique(suppliedCriterionIds, "Criterion IDs");
    for (const input of inputs) {
      assertNonNegativePositions(input.judgementStatements ?? [], "Judgement statement");
    }

    const timestamp = this.clock();
    this.db.transaction((tx) => {
      tx.delete(criteria).where(eq(criteria.reviewId, reviewId)).run();
      for (const input of inputs) {
        const criterionId = input.id ?? this.idFactory();
        tx.insert(criteria)
          .values({
            id: criterionId,
            reviewId,
            title: input.title,
            statement: input.statement,
            assessorNote: input.assessorNote ?? null,
            position: input.position,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run();
        if (input.judgementStatements?.length) {
          tx.insert(judgementStatements)
            .values(
              input.judgementStatements.map((statement) => ({
                id: statement.id ?? this.idFactory(),
                criterionId,
                label: statement.label,
                description: statement.description,
                position: statement.position,
                createdAt: timestamp,
                updatedAt: timestamp,
              })),
            )
            .run();
        }
      }
      tx.update(reviews).set({ updatedAt: timestamp }).where(eq(reviews.id, reviewId)).run();
    });

    return this.listCriteria(reviewId);
  }

  listJudgementStatements(criterionId: string): JudgementStatementRow[] {
    return this.db
      .select()
      .from(judgementStatements)
      .where(eq(judgementStatements.criterionId, criterionId))
      .orderBy(asc(judgementStatements.position))
      .all();
  }

  getCriterion(criterionId: string): CriterionWithStatements | null {
    const criterion = this.db.select().from(criteria).where(eq(criteria.id, criterionId)).get();
    if (!criterion) return null;
    return {
      ...criterion,
      judgementStatements: this.listJudgementStatements(criterionId),
    };
  }

  requireCriterion(criterionId: string): CriterionWithStatements {
    const criterion = this.getCriterion(criterionId);
    if (!criterion) throw new RecordNotFoundError(`Criterion ${criterionId} was not found`);
    return criterion;
  }

  listCriteria(reviewId: string): CriterionWithStatements[] {
    return this.db
      .select()
      .from(criteria)
      .where(eq(criteria.reviewId, reviewId))
      .orderBy(asc(criteria.position))
      .all()
      .map((criterion) => ({
        ...criterion,
        judgementStatements: this.listJudgementStatements(criterion.id),
      }));
  }

  getAggregate(reviewId: string): ReviewAggregate | null {
    const review = this.getById(reviewId);
    if (!review) return null;
    return {
      review,
      imageRevision: this.getLatestImageRevision(reviewId),
      reviewAreas: this.listReviewAreaSelections(reviewId),
      criteria: this.listCriteria(reviewId),
    };
  }
}
