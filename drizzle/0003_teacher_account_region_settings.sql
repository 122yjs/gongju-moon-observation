ALTER TABLE `teacher_accounts` ADD `region_label` text NOT NULL DEFAULT '관찰 지역';
--> statement-breakpoint
ALTER TABLE `teacher_accounts` ADD `region_short_label` text NOT NULL DEFAULT '지역';
--> statement-breakpoint
ALTER TABLE `teacher_accounts` ADD `observation_lat` real NOT NULL DEFAULT 36.5;
--> statement-breakpoint
ALTER TABLE `teacher_accounts` ADD `observation_lon` real NOT NULL DEFAULT 127.5;
--> statement-breakpoint
ALTER TABLE `teacher_accounts` ADD `region_settings_completed_at` text;
