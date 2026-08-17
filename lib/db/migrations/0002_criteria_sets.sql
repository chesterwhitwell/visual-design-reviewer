CREATE TABLE `criteria_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`description` text,
	`schema_version` text NOT NULL,
	`criteria_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `criteria_sets_normalized_name_uq` ON `criteria_sets` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `criteria_sets_name_idx` ON `criteria_sets` (`name`);
