CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`context` text,
	`lifecycle` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`closed_at` text,
	CONSTRAINT `reviews_lifecycle_check` CHECK (`lifecycle` in ('active', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `reviews_updated_at_idx` ON `reviews` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `image_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`display_name` text,
	`original_filename` text,
	`content_digest` text NOT NULL,
	`mime_type` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`byte_size` integer NOT NULL,
	`storage_locator` text,
	`thumbnail_storage_locator` text,
	`encryption_version` integer,
	`retention_state` text DEFAULT 'retained' NOT NULL,
	`expires_at` text,
	`purge_requested_at` text,
	`purged_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `image_assets_mime_type_check` CHECK (`mime_type` in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT `image_assets_width_check` CHECK (`width` > 0),
	CONSTRAINT `image_assets_height_check` CHECK (`height` > 0),
	CONSTRAINT `image_assets_byte_size_check` CHECK (`byte_size` > 0),
	CONSTRAINT `image_assets_retention_state_check` CHECK (`retention_state` in ('retained', 'purge_pending', 'purged'))
);
--> statement-breakpoint
CREATE INDEX `image_assets_review_id_idx` ON `image_assets` (`review_id`);
--> statement-breakpoint
CREATE INDEX `image_assets_expiry_idx` ON `image_assets` (`retention_state`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `image_assets_content_digest_idx` ON `image_assets` (`content_digest`);
--> statement-breakpoint
CREATE TABLE `review_image_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `review_image_revisions_version_check` CHECK (`version` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_image_revisions_review_version_uq` ON `review_image_revisions` (`review_id`,`version`);
--> statement-breakpoint
CREATE TABLE `review_image_revision_items` (
	`revision_id` text NOT NULL,
	`image_asset_id` text NOT NULL,
	`position` integer NOT NULL,
	`image_label` text NOT NULL,
	PRIMARY KEY(`revision_id`, `position`),
	FOREIGN KEY (`revision_id`) REFERENCES `review_image_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_asset_id`) REFERENCES `image_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `review_image_revision_items_position_check` CHECK (`position` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_image_revision_items_asset_uq` ON `review_image_revision_items` (`revision_id`,`image_asset_id`);
--> statement-breakpoint
CREATE INDEX `review_image_revision_items_asset_idx` ON `review_image_revision_items` (`image_asset_id`);
--> statement-breakpoint
CREATE TABLE `review_area_selections` (
	`review_id` text NOT NULL,
	`area_id` text NOT NULL,
	`taxonomy_version` text NOT NULL,
	`area_label` text NOT NULL,
	`mode` text NOT NULL,
	`position` integer NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`review_id`, `area_id`),
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `review_area_selections_mode_check` CHECK (`mode` in ('off', 'review', 'focus')),
	CONSTRAINT `review_area_selections_position_check` CHECK (`position` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_area_selections_position_uq` ON `review_area_selections` (`review_id`,`position`);
--> statement-breakpoint
CREATE TABLE `criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`title` text NOT NULL,
	`statement` text NOT NULL,
	`assessor_note` text,
	`position` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `criteria_position_check` CHECK (`position` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `criteria_review_position_uq` ON `criteria` (`review_id`,`position`);
--> statement-breakpoint
CREATE INDEX `criteria_review_id_idx` ON `criteria` (`review_id`);
--> statement-breakpoint
CREATE TABLE `judgement_statements` (
	`id` text PRIMARY KEY NOT NULL,
	`criterion_id` text NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`criterion_id`) REFERENCES `criteria`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `judgement_statements_position_check` CHECK (`position` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `judgement_statements_criterion_position_uq` ON `judgement_statements` (`criterion_id`,`position`);
--> statement-breakpoint
CREATE INDEX `judgement_statements_criterion_id_idx` ON `judgement_statements` (`criterion_id`);
--> statement-breakpoint
CREATE TABLE `taxonomy_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`taxonomy_version` text NOT NULL,
	`selections_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `taxonomy_presets_name_uq` ON `taxonomy_presets` (`name`);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`kind` text NOT NULL,
	`image_revision_id` text NOT NULL,
	`selected_design_analysis_id` text,
	`idempotency_key` text,
	`input_snapshot_json` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`safe_error_code` text,
	`safe_error_message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_revision_id`) REFERENCES `review_image_revisions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`selected_design_analysis_id`) REFERENCES `design_analyses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `analysis_runs_kind_check` CHECK (`kind` in ('design', 'criteria')),
	CONSTRAINT `analysis_runs_state_check` CHECK (`state` in ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT `analysis_runs_selected_design_check` CHECK ((`kind` = 'design' and `selected_design_analysis_id` is null) or (`kind` = 'criteria' and `selected_design_analysis_id` is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_runs_idempotency_uq` ON `analysis_runs` (`review_id`,`kind`,`idempotency_key`);
--> statement-breakpoint
CREATE INDEX `analysis_runs_queue_idx` ON `analysis_runs` (`state`,`created_at`);
--> statement-breakpoint
CREATE INDEX `analysis_runs_review_idx` ON `analysis_runs` (`review_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `analysis_runs_lease_idx` ON `analysis_runs` (`state`,`lease_expires_at`);
--> statement-breakpoint
CREATE TABLE `analysis_passes` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`pass_key` text NOT NULL,
	`position` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`safe_error_code` text,
	`safe_error_message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `analysis_passes_position_check` CHECK (`position` >= 0),
	CONSTRAINT `analysis_passes_state_check` CHECK (`state` in ('pending', 'running', 'completed', 'failed', 'cancelled', 'skipped', 'interrupted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_passes_run_key_uq` ON `analysis_passes` (`run_id`,`pass_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_passes_run_position_uq` ON `analysis_passes` (`run_id`,`position`);
--> statement-breakpoint
CREATE INDEX `analysis_passes_run_idx` ON `analysis_passes` (`run_id`,`position`);
--> statement-breakpoint
CREATE TABLE `pass_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`pass_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`image_detail` text,
	`reasoning_effort` text,
	`prompt_version` text NOT NULL,
	`schema_version` text NOT NULL,
	`safe_error_code` text,
	`safe_error_message` text,
	`api_status_code` integer,
	`api_request_id` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`total_tokens` integer,
	`validated_output_json` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`response_received_at` text,
	`completed_at` text,
	`duration_ms` integer,
	FOREIGN KEY (`pass_id`) REFERENCES `analysis_passes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `pass_attempts_number_check` CHECK (`attempt_number` > 0),
	CONSTRAINT `pass_attempts_state_check` CHECK (`state` in ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT `pass_attempts_duration_check` CHECK (`duration_ms` is null or `duration_ms` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pass_attempts_pass_number_uq` ON `pass_attempts` (`pass_id`,`attempt_number`);
--> statement-breakpoint
CREATE INDEX `pass_attempts_pass_idx` ON `pass_attempts` (`pass_id`,`attempt_number`);
--> statement-breakpoint
CREATE TABLE `design_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`source_run_id` text NOT NULL,
	`review_id` text NOT NULL,
	`version` integer NOT NULL,
	`schema_version` text NOT NULL,
	`prompt_set_version` text NOT NULL,
	`input_snapshot_json` text NOT NULL,
	`pass_provenance_json` text NOT NULL,
	`artifact_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `design_analyses_version_check` CHECK (`version` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `design_analyses_source_run_id_unique` ON `design_analyses` (`source_run_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `design_analyses_review_version_uq` ON `design_analyses` (`review_id`,`version`);
--> statement-breakpoint
CREATE INDEX `design_analyses_review_idx` ON `design_analyses` (`review_id`,`version`);
--> statement-breakpoint
CREATE TABLE `criteria_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`source_run_id` text NOT NULL,
	`review_id` text NOT NULL,
	`version` integer NOT NULL,
	`design_analysis_id` text NOT NULL,
	`schema_version` text NOT NULL,
	`prompt_set_version` text NOT NULL,
	`criteria_snapshot_json` text NOT NULL,
	`input_snapshot_json` text NOT NULL,
	`pass_provenance_json` text NOT NULL,
	`artifact_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`source_run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`design_analysis_id`) REFERENCES `design_analyses`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `criteria_analyses_version_check` CHECK (`version` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `criteria_analyses_source_run_id_unique` ON `criteria_analyses` (`source_run_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `criteria_analyses_review_version_uq` ON `criteria_analyses` (`review_id`,`version`);
--> statement-breakpoint
CREATE INDEX `criteria_analyses_review_idx` ON `criteria_analyses` (`review_id`,`version`);
--> statement-breakpoint
CREATE INDEX `criteria_analyses_design_idx` ON `criteria_analyses` (`design_analysis_id`);
--> statement-breakpoint
CREATE TRIGGER `review_image_revisions_immutable_update`
BEFORE UPDATE ON `review_image_revisions`
BEGIN
	SELECT RAISE(ABORT, 'review image revisions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `review_image_revision_items_immutable_update`
BEFORE UPDATE ON `review_image_revision_items`
BEGIN
	SELECT RAISE(ABORT, 'review image revision items are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `image_assets_immutable_metadata`
BEFORE UPDATE OF `review_id`, `content_digest`, `mime_type`, `width`, `height`, `byte_size` ON `image_assets`
BEGIN
	SELECT RAISE(ABORT, 'sanitised image metadata is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `design_analyses_immutable_update`
BEFORE UPDATE ON `design_analyses`
BEGIN
	SELECT RAISE(ABORT, 'design analyses are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `criteria_analyses_immutable_update`
BEFORE UPDATE ON `criteria_analyses`
BEGIN
	SELECT RAISE(ABORT, 'criteria analyses are immutable');
END;
