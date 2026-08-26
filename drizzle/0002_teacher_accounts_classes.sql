CREATE TABLE `teacher_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`google_permission_id` text NOT NULL,
	`google_email` text NOT NULL,
	`google_display_name` text NOT NULL,
	`refresh_token_ciphertext` text NOT NULL,
	`access_token_ciphertext` text,
	`access_token_expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `teacher_accounts` (
	`id`,
	`google_permission_id`,
	`google_email`,
	`google_display_name`,
	`refresh_token_ciphertext`,
	`access_token_ciphertext`,
	`access_token_expires_at`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`google_permission_id`,
	`google_email`,
	`google_display_name`,
	`refresh_token_ciphertext`,
	`access_token_ciphertext`,
	`access_token_expires_at`,
	`created_at`,
	`updated_at`
FROM `teacher_connections`;
--> statement-breakpoint
ALTER TABLE `teacher_connections` ADD `account_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `teacher_connections` SET `account_id` = `id` WHERE `account_id` = '';
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_accounts_google_permission_unique` ON `teacher_accounts` (`google_permission_id`);
--> statement-breakpoint
CREATE INDEX `teacher_connections_account_idx` ON `teacher_connections` (`account_id`);
--> statement-breakpoint
DROP INDEX `teacher_connections_google_permission_unique`;
