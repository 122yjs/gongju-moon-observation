CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`class_id` text NOT NULL,
	`session_id` text NOT NULL,
	`student_number` integer NOT NULL,
	`student_name` text NOT NULL,
	`observed_at` text NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`image_key` text NOT NULL,
	`image_type` text DEFAULT 'image/jpeg' NOT NULL,
	`image_bytes` integer NOT NULL,
	`status` text DEFAULT 'visible' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observations_request_id_unique` ON `observations` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `observations_image_key_unique` ON `observations` (`image_key`);--> statement-breakpoint
CREATE INDEX `observations_class_created_idx` ON `observations` (`class_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `observations_session_created_idx` ON `observations` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `observations_status_created_idx` ON `observations` (`status`,`created_at`);