CREATE TABLE `observation_hearts` (
	`class_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`voter_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`class_id`, `observation_id`, `voter_key`),
	FOREIGN KEY (`class_id`) REFERENCES `teacher_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
