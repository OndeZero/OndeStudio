CREATE TABLE `assignment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`user_id` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_object_type_object_id_user_id_unique` ON `assignment` (`object_type`,`object_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `card_read` (
	`card_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_read_card_id_user_id_unique` ON `card_read` (`card_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `card` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`intent` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`subject` text NOT NULL,
	`body` text,
	`anchor_type` text,
	`anchor_id` text,
	`outcome` text,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_activity_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`anchor_type` text,
	`anchor_id` text,
	`card_id` integer,
	`created_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE TABLE `vote` (
	`card_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `card`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vote_card_id_user_id_unique` ON `vote` (`card_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `show` ADD `fallback_policy` text DEFAULT 'discard' NOT NULL;--> statement-breakpoint
ALTER TABLE `show` ADD `trust_auto_air` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `show` ADD `replay_flag` text DEFAULT 'not_specified' NOT NULL;--> statement-breakpoint
ALTER TABLE `show` ADD `contributor_tz` text;--> statement-breakpoint
ALTER TABLE `show` ADD `drop_folder_path` text;