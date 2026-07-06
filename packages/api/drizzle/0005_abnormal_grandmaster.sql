CREATE TABLE `broadcaster` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`kind` text DEFAULT 'external' NOT NULL,
	`comment_meta` text,
	`enforce_schedule` integer DEFAULT false NOT NULL,
	`replay_flag` text DEFAULT 'not_specified' NOT NULL,
	`password_hash` text,
	`main_streamer_ref` text,
	`test_streamer_ref` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `broadcaster_username_unique` ON `broadcaster` (`username`);