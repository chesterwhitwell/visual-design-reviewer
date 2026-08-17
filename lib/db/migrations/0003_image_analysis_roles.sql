PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_review_image_revision_items` (
	`revision_id` text NOT NULL,
	`image_asset_id` text NOT NULL,
	`position` integer NOT NULL,
	`image_label` text NOT NULL,
	`analysis_role` text DEFAULT 'final_work' NOT NULL,
	PRIMARY KEY(`revision_id`, `position`),
	FOREIGN KEY (`revision_id`) REFERENCES `review_image_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_asset_id`) REFERENCES `image_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_image_revision_items_position_check" CHECK("__new_review_image_revision_items"."position" >= 0),
	CONSTRAINT "review_image_revision_items_analysis_role_check" CHECK("__new_review_image_revision_items"."analysis_role" in ('final_work', 'concept_development'))
);
--> statement-breakpoint
INSERT INTO `__new_review_image_revision_items`("revision_id", "image_asset_id", "position", "image_label", "analysis_role") SELECT "revision_id", "image_asset_id", "position", "image_label", 'final_work' FROM `review_image_revision_items`;--> statement-breakpoint
DROP TABLE `review_image_revision_items`;--> statement-breakpoint
ALTER TABLE `__new_review_image_revision_items` RENAME TO `review_image_revision_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `review_image_revision_items_asset_uq` ON `review_image_revision_items` (`revision_id`,`image_asset_id`);--> statement-breakpoint
CREATE INDEX `review_image_revision_items_asset_idx` ON `review_image_revision_items` (`image_asset_id`);--> statement-breakpoint
CREATE TRIGGER `review_image_revision_items_immutable_update`
BEFORE UPDATE ON `review_image_revision_items`
BEGIN
	SELECT RAISE(ABORT, 'review image revision items are immutable');
END;
