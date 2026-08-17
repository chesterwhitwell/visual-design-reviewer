CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`display_name` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	CONSTRAINT "auth_sessions_provider_check" CHECK("auth_sessions"."provider" in ('password', 'oidc'))
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_expiry_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `auth_sessions_principal_idx` ON `auth_sessions` (`principal_id`,`revoked_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pass_attempts` (
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
	`cached_input_tokens` integer,
	`cache_write_input_tokens` integer,
	`output_tokens` integer,
	`reasoning_output_tokens` integer,
	`total_tokens` integer,
	`estimated_cost_micro_usd` integer,
	`pricing_snapshot_json` text,
	`validated_output_json` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`response_received_at` text,
	`completed_at` text,
	`duration_ms` integer,
	FOREIGN KEY (`pass_id`) REFERENCES `analysis_passes`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pass_attempts_number_check" CHECK("__new_pass_attempts"."attempt_number" > 0),
	CONSTRAINT "pass_attempts_state_check" CHECK("__new_pass_attempts"."state" in ('running', 'completed', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT "pass_attempts_duration_check" CHECK("__new_pass_attempts"."duration_ms" is null or "__new_pass_attempts"."duration_ms" >= 0),
	CONSTRAINT "pass_attempts_usage_check" CHECK(("__new_pass_attempts"."input_tokens" is null or "__new_pass_attempts"."input_tokens" >= 0)
        and ("__new_pass_attempts"."cached_input_tokens" is null or "__new_pass_attempts"."cached_input_tokens" >= 0)
        and ("__new_pass_attempts"."cache_write_input_tokens" is null or "__new_pass_attempts"."cache_write_input_tokens" >= 0)
        and ("__new_pass_attempts"."output_tokens" is null or "__new_pass_attempts"."output_tokens" >= 0)
        and ("__new_pass_attempts"."reasoning_output_tokens" is null or "__new_pass_attempts"."reasoning_output_tokens" >= 0)
        and ("__new_pass_attempts"."total_tokens" is null or "__new_pass_attempts"."total_tokens" >= 0)
        and ("__new_pass_attempts"."estimated_cost_micro_usd" is null or "__new_pass_attempts"."estimated_cost_micro_usd" >= 0))
);
--> statement-breakpoint
INSERT INTO `__new_pass_attempts`("id", "pass_id", "attempt_number", "state", "provider", "model", "image_detail", "reasoning_effort", "prompt_version", "schema_version", "safe_error_code", "safe_error_message", "api_status_code", "api_request_id", "input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens", "estimated_cost_micro_usd", "pricing_snapshot_json", "validated_output_json", "started_at", "response_received_at", "completed_at", "duration_ms") SELECT "id", "pass_id", "attempt_number", "state", "provider", "model", "image_detail", "reasoning_effort", "prompt_version", "schema_version", "safe_error_code", "safe_error_message", "api_status_code", "api_request_id", "input_tokens", NULL, NULL, "output_tokens", NULL, "total_tokens", NULL, NULL, "validated_output_json", "started_at", "response_received_at", "completed_at", "duration_ms" FROM `pass_attempts`;--> statement-breakpoint
DROP TABLE `pass_attempts`;--> statement-breakpoint
ALTER TABLE `__new_pass_attempts` RENAME TO `pass_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `pass_attempts_pass_number_uq` ON `pass_attempts` (`pass_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `pass_attempts_pass_idx` ON `pass_attempts` (`pass_id`,`attempt_number`);
