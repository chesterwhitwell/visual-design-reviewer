import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export type JsonSnapshot = Record<string, unknown> | readonly unknown[];

const timestampDefault = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    title: text("title"),
    context: text("context"),
    lifecycle: text("lifecycle", { enum: ["active", "closed"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(timestampDefault),
    updatedAt: text("updated_at").notNull().default(timestampDefault),
    closedAt: text("closed_at"),
  },
  (table) => [
    check("reviews_lifecycle_check", sql`${table.lifecycle} in ('active', 'closed')`),
    index("reviews_updated_at_idx").on(table.updatedAt),
  ],
);

export const imageAssets = sqliteTable(
  "image_assets",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    originalFilename: text("original_filename"),
    contentDigest: text("content_digest").notNull(),
    mimeType: text("mime_type", {
      enum: ["image/jpeg", "image/png", "image/webp"],
    }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    byteSize: integer("byte_size").notNull(),
    storageLocator: text("storage_locator"),
    thumbnailStorageLocator: text("thumbnail_storage_locator"),
    encryptionVersion: integer("encryption_version"),
    retentionState: text("retention_state", {
      enum: ["retained", "purge_pending", "purged"],
    })
      .notNull()
      .default("retained"),
    expiresAt: text("expires_at"),
    purgeRequestedAt: text("purge_requested_at"),
    purgedAt: text("purged_at"),
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    check(
      "image_assets_mime_type_check",
      sql`${table.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check("image_assets_width_check", sql`${table.width} > 0`),
    check("image_assets_height_check", sql`${table.height} > 0`),
    check("image_assets_byte_size_check", sql`${table.byteSize} > 0`),
    check(
      "image_assets_retention_state_check",
      sql`${table.retentionState} in ('retained', 'purge_pending', 'purged')`,
    ),
    index("image_assets_review_id_idx").on(table.reviewId),
    index("image_assets_expiry_idx").on(table.retentionState, table.expiresAt),
    index("image_assets_content_digest_idx").on(table.contentDigest),
  ],
);

export const reviewImageRevisions = sqliteTable(
  "review_image_revisions",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    check("review_image_revisions_version_check", sql`${table.version} > 0`),
    uniqueIndex("review_image_revisions_review_version_uq").on(
      table.reviewId,
      table.version,
    ),
  ],
);

export const reviewImageRevisionItems = sqliteTable(
  "review_image_revision_items",
  {
    revisionId: text("revision_id")
      .notNull()
      .references(() => reviewImageRevisions.id, { onDelete: "cascade" }),
    imageAssetId: text("image_asset_id")
      .notNull()
      .references(() => imageAssets.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    imageLabel: text("image_label").notNull(),
    analysisRole: text("analysis_role", {
      enum: ["final_work", "concept_development"],
    })
      .notNull()
      .default("final_work"),
  },
  (table) => [
    primaryKey({ columns: [table.revisionId, table.position] }),
    uniqueIndex("review_image_revision_items_asset_uq").on(
      table.revisionId,
      table.imageAssetId,
    ),
    check("review_image_revision_items_position_check", sql`${table.position} >= 0`),
    check(
      "review_image_revision_items_analysis_role_check",
      sql`${table.analysisRole} in ('final_work', 'concept_development')`,
    ),
    index("review_image_revision_items_asset_idx").on(table.imageAssetId),
  ],
);

export const reviewAreaSelections = sqliteTable(
  "review_area_selections",
  {
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    areaId: text("area_id").notNull(),
    taxonomyVersion: text("taxonomy_version").notNull(),
    areaLabel: text("area_label").notNull(),
    mode: text("mode", { enum: ["off", "review", "focus"] }).notNull(),
    position: integer("position").notNull(),
    updatedAt: text("updated_at").notNull().default(timestampDefault),
  },
  (table) => [
    primaryKey({ columns: [table.reviewId, table.areaId] }),
    uniqueIndex("review_area_selections_position_uq").on(table.reviewId, table.position),
    check("review_area_selections_mode_check", sql`${table.mode} in ('off', 'review', 'focus')`),
    check("review_area_selections_position_check", sql`${table.position} >= 0`),
  ],
);

export const criteria = sqliteTable(
  "criteria",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    statement: text("statement").notNull(),
    assessorNote: text("assessor_note"),
    position: integer("position").notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
    updatedAt: text("updated_at").notNull().default(timestampDefault),
  },
  (table) => [
    uniqueIndex("criteria_review_position_uq").on(table.reviewId, table.position),
    check("criteria_position_check", sql`${table.position} >= 0`),
    index("criteria_review_id_idx").on(table.reviewId),
  ],
);

export const judgementStatements = sqliteTable(
  "judgement_statements",
  {
    id: text("id").primaryKey(),
    criterionId: text("criterion_id")
      .notNull()
      .references(() => criteria.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description").notNull(),
    position: integer("position").notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
    updatedAt: text("updated_at").notNull().default(timestampDefault),
  },
  (table) => [
    uniqueIndex("judgement_statements_criterion_position_uq").on(
      table.criterionId,
      table.position,
    ),
    check("judgement_statements_position_check", sql`${table.position} >= 0`),
    index("judgement_statements_criterion_id_idx").on(table.criterionId),
  ],
);

export const taxonomyPresets = sqliteTable(
  "taxonomy_presets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    taxonomyVersion: text("taxonomy_version").notNull(),
    selections: text("selections_json", { mode: "json" }).$type<JsonSnapshot>().notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
    updatedAt: text("updated_at").notNull().default(timestampDefault),
  },
  (table) => [uniqueIndex("taxonomy_presets_name_uq").on(table.name)],
);

export const criteriaSets = sqliteTable(
  "criteria_sets",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    description: text("description"),
    schemaVersion: text("schema_version").notNull(),
    criteria: text("criteria_json", { mode: "json" }).$type<JsonSnapshot>().notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
    updatedAt: text("updated_at").notNull().default(timestampDefault),
  },
  (table) => [
    uniqueIndex("criteria_sets_normalized_name_uq").on(table.normalizedName),
    index("criteria_sets_name_idx").on(table.name),
  ],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value_json", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: text("updated_at").notNull().default(timestampDefault),
});

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    principalId: text("principal_id").notNull(),
    displayName: text("display_name").notNull(),
    provider: text("provider", { enum: ["password", "oidc"] }).notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
    lastSeenAt: text("last_seen_at").notNull().default(timestampDefault),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    check("auth_sessions_provider_check", sql`${table.provider} in ('password', 'oidc')`),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
    index("auth_sessions_principal_idx").on(table.principalId, table.revokedAt),
  ],
);

export const analysisRuns = sqliteTable(
  "analysis_runs",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["design", "criteria"] }).notNull(),
    imageRevisionId: text("image_revision_id")
      .notNull()
      .references(() => reviewImageRevisions.id, { onDelete: "restrict" }),
    selectedDesignAnalysisId: text("selected_design_analysis_id"),
    idempotencyKey: text("idempotency_key"),
    inputSnapshot: text("input_snapshot_json", { mode: "json" })
      .$type<JsonSnapshot>()
      .notNull(),
    state: text("state", {
      enum: ["queued", "running", "completed", "failed", "cancelled", "interrupted"],
    })
      .notNull()
      .default("queued"),
    cancelRequested: integer("cancel_requested", { mode: "boolean" })
      .notNull()
      .default(false),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    safeErrorCode: text("safe_error_code"),
    safeErrorMessage: text("safe_error_message"),
    createdAt: text("created_at").notNull().default(timestampDefault),
    updatedAt: text("updated_at").notNull().default(timestampDefault),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    check("analysis_runs_kind_check", sql`${table.kind} in ('design', 'criteria')`),
    check(
      "analysis_runs_state_check",
      sql`${table.state} in ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')`,
    ),
    check(
      "analysis_runs_selected_design_check",
      sql`(${table.kind} = 'design' and ${table.selectedDesignAnalysisId} is null) or (${table.kind} = 'criteria' and ${table.selectedDesignAnalysisId} is not null)`,
    ),
    uniqueIndex("analysis_runs_idempotency_uq").on(
      table.reviewId,
      table.kind,
      table.idempotencyKey,
    ),
    index("analysis_runs_queue_idx").on(table.state, table.createdAt),
    index("analysis_runs_review_idx").on(table.reviewId, table.createdAt),
    index("analysis_runs_lease_idx").on(table.state, table.leaseExpiresAt),
  ],
);

export const analysisPasses = sqliteTable(
  "analysis_passes",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => analysisRuns.id, { onDelete: "cascade" }),
    passKey: text("pass_key").notNull(),
    position: integer("position").notNull(),
    state: text("state", {
      enum: [
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "skipped",
        "interrupted",
      ],
    })
      .notNull()
      .default("pending"),
    safeErrorCode: text("safe_error_code"),
    safeErrorMessage: text("safe_error_message"),
    createdAt: text("created_at").notNull().default(timestampDefault),
    updatedAt: text("updated_at").notNull().default(timestampDefault),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("analysis_passes_run_key_uq").on(table.runId, table.passKey),
    uniqueIndex("analysis_passes_run_position_uq").on(table.runId, table.position),
    check("analysis_passes_position_check", sql`${table.position} >= 0`),
    check(
      "analysis_passes_state_check",
      sql`${table.state} in ('pending', 'running', 'completed', 'failed', 'cancelled', 'skipped', 'interrupted')`,
    ),
    index("analysis_passes_run_idx").on(table.runId, table.position),
  ],
);

export const passAttempts = sqliteTable(
  "pass_attempts",
  {
    id: text("id").primaryKey(),
    passId: text("pass_id")
      .notNull()
      .references(() => analysisPasses.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    state: text("state", {
      enum: ["running", "completed", "failed", "cancelled", "interrupted"],
    })
      .notNull()
      .default("running"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    imageDetail: text("image_detail"),
    reasoningEffort: text("reasoning_effort"),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    safeErrorCode: text("safe_error_code"),
    safeErrorMessage: text("safe_error_message"),
    apiStatusCode: integer("api_status_code"),
    apiRequestId: text("api_request_id"),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    cacheWriteInputTokens: integer("cache_write_input_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningOutputTokens: integer("reasoning_output_tokens"),
    totalTokens: integer("total_tokens"),
    estimatedCostMicroUsd: integer("estimated_cost_micro_usd"),
    pricingSnapshot: text("pricing_snapshot_json", { mode: "json" }).$type<JsonSnapshot>(),
    validatedOutput: text("validated_output_json", { mode: "json" }).$type<unknown>(),
    startedAt: text("started_at").notNull().default(timestampDefault),
    responseReceivedAt: text("response_received_at"),
    completedAt: text("completed_at"),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    uniqueIndex("pass_attempts_pass_number_uq").on(table.passId, table.attemptNumber),
    check("pass_attempts_number_check", sql`${table.attemptNumber} > 0`),
    check(
      "pass_attempts_state_check",
      sql`${table.state} in ('running', 'completed', 'failed', 'cancelled', 'interrupted')`,
    ),
    check(
      "pass_attempts_duration_check",
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
    check(
      "pass_attempts_usage_check",
      sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0)
        and (${table.cachedInputTokens} is null or ${table.cachedInputTokens} >= 0)
        and (${table.cacheWriteInputTokens} is null or ${table.cacheWriteInputTokens} >= 0)
        and (${table.outputTokens} is null or ${table.outputTokens} >= 0)
        and (${table.reasoningOutputTokens} is null or ${table.reasoningOutputTokens} >= 0)
        and (${table.totalTokens} is null or ${table.totalTokens} >= 0)
        and (${table.estimatedCostMicroUsd} is null or ${table.estimatedCostMicroUsd} >= 0)`,
    ),
    index("pass_attempts_pass_idx").on(table.passId, table.attemptNumber),
  ],
);

export const designAnalyses = sqliteTable(
  "design_analyses",
  {
    id: text("id").primaryKey(),
    sourceRunId: text("source_run_id")
      .notNull()
      .unique()
      .references(() => analysisRuns.id, { onDelete: "restrict" }),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    promptSetVersion: text("prompt_set_version").notNull(),
    inputSnapshot: text("input_snapshot_json", { mode: "json" })
      .$type<JsonSnapshot>()
      .notNull(),
    passProvenance: text("pass_provenance_json", { mode: "json" })
      .$type<JsonSnapshot>()
      .notNull(),
    artifact: text("artifact_json", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    uniqueIndex("design_analyses_review_version_uq").on(table.reviewId, table.version),
    check("design_analyses_version_check", sql`${table.version} > 0`),
    index("design_analyses_review_idx").on(table.reviewId, table.version),
  ],
);

export const criteriaAnalyses = sqliteTable(
  "criteria_analyses",
  {
    id: text("id").primaryKey(),
    sourceRunId: text("source_run_id")
      .notNull()
      .unique()
      .references(() => analysisRuns.id, { onDelete: "restrict" }),
    reviewId: text("review_id")
      .notNull()
      .references(() => reviews.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    designAnalysisId: text("design_analysis_id")
      .notNull()
      .references(() => designAnalyses.id, { onDelete: "restrict" }),
    schemaVersion: text("schema_version").notNull(),
    promptSetVersion: text("prompt_set_version").notNull(),
    criteriaSnapshot: text("criteria_snapshot_json", { mode: "json" })
      .$type<JsonSnapshot>()
      .notNull(),
    inputSnapshot: text("input_snapshot_json", { mode: "json" })
      .$type<JsonSnapshot>()
      .notNull(),
    passProvenance: text("pass_provenance_json", { mode: "json" })
      .$type<JsonSnapshot>()
      .notNull(),
    artifact: text("artifact_json", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: text("created_at").notNull().default(timestampDefault),
  },
  (table) => [
    uniqueIndex("criteria_analyses_review_version_uq").on(table.reviewId, table.version),
    check("criteria_analyses_version_check", sql`${table.version} > 0`),
    index("criteria_analyses_review_idx").on(table.reviewId, table.version),
    index("criteria_analyses_design_idx").on(table.designAnalysisId),
  ],
);

export type ReviewRow = typeof reviews.$inferSelect;
export type ImageAssetRow = typeof imageAssets.$inferSelect;
export type ReviewImageRevisionRow = typeof reviewImageRevisions.$inferSelect;
export type ReviewAreaSelectionRow = typeof reviewAreaSelections.$inferSelect;
export type CriterionRow = typeof criteria.$inferSelect;
export type JudgementStatementRow = typeof judgementStatements.$inferSelect;
export type AnalysisRunRow = typeof analysisRuns.$inferSelect;
export type AnalysisPassRow = typeof analysisPasses.$inferSelect;
export type PassAttemptRow = typeof passAttempts.$inferSelect;
export type DesignAnalysisRow = typeof designAnalyses.$inferSelect;
export type CriteriaAnalysisRow = typeof criteriaAnalyses.$inferSelect;
export type CriteriaSetRow = typeof criteriaSets.$inferSelect;
export type AuthSessionRow = typeof authSessions.$inferSelect;
