CREATE TABLE `oauth_config` (
  `id` text PRIMARY KEY NOT NULL,
  `client_id` text NOT NULL,
  `client_secret_ciphertext` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `teacher_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `google_permission_id` text NOT NULL,
  `google_email` text NOT NULL,
  `google_display_name` text NOT NULL,
  `refresh_token_ciphertext` text NOT NULL,
  `access_token_ciphertext` text,
  `access_token_expires_at` text,
  `root_folder_id` text NOT NULL,
  `photos_folder_id` text NOT NULL,
  `spreadsheet_id` text NOT NULL,
  `sheet_id` integer NOT NULL,
  `sheet_title` text NOT NULL,
  `invite_token_hash` text NOT NULL,
  `invite_token_ciphertext` text NOT NULL,
  `class_label` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_connections_google_permission_unique` ON `teacher_connections` (`google_permission_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_connections_invite_hash_unique` ON `teacher_connections` (`invite_token_hash`);
--> statement-breakpoint
CREATE TABLE `submission_receipts` (
  `request_id` text PRIMARY KEY NOT NULL,
  `teacher_id` text NOT NULL,
  `observation_id` text,
  `status` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  FOREIGN KEY (`teacher_id`) REFERENCES `teacher_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submission_receipts_expires_idx` ON `submission_receipts` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `submission_events` (
  `id` text PRIMARY KEY NOT NULL,
  `teacher_id` text NOT NULL,
  `session_id` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL,
  FOREIGN KEY (`teacher_id`) REFERENCES `teacher_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submission_events_teacher_created_idx` ON `submission_events` (`teacher_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `submission_events_session_created_idx` ON `submission_events` (`session_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `submission_events_expires_idx` ON `submission_events` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `image_tickets` (
  `observation_id` text PRIMARY KEY NOT NULL,
  `teacher_id` text NOT NULL,
  `file_id` text NOT NULL,
  `image_type` text NOT NULL,
  `status` text NOT NULL,
  `expires_at` text NOT NULL,
  FOREIGN KEY (`teacher_id`) REFERENCES `teacher_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `image_tickets_teacher_idx` ON `image_tickets` (`teacher_id`);
--> statement-breakpoint
CREATE INDEX `image_tickets_expires_idx` ON `image_tickets` (`expires_at`);
