ALTER TABLE `teacher_connections` ADD `summary_sheet_id` integer;
--> statement-breakpoint
ALTER TABLE `teacher_connections` ADD `sheet_schema_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE `observation_row_index` (
	`teacher_id` text NOT NULL,
	`spreadsheet_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`row_number` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`teacher_id`, `observation_id`),
	FOREIGN KEY (`teacher_id`) REFERENCES `teacher_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `observation_row_index_sheet_idx` ON `observation_row_index` (`spreadsheet_id`);
--> statement-breakpoint
CREATE TABLE `sheet_write_locks` (
	`spreadsheet_id` text PRIMARY KEY NOT NULL,
	`teacher_id` text,
	`owner_token` text NOT NULL,
	`operation` text NOT NULL,
	`observation_id` text,
	`expected_version` text,
	`intended_version` text,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
