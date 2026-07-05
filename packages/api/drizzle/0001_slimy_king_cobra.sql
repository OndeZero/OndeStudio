CREATE TABLE `occurrence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slot_id` integer NOT NULL,
	`original_starts_at_utc` text NOT NULL,
	`starts_at_utc` text NOT NULL,
	`ends_at_utc` text NOT NULL,
	`negotiation_state` text NOT NULL,
	`content_state` text DEFAULT 'empty' NOT NULL,
	`issue_flags` text DEFAULT '[]' NOT NULL,
	`content_duration_min` integer,
	FOREIGN KEY (`slot_id`) REFERENCES `slot`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `occurrence_slot_id_original_starts_at_utc_unique` ON `occurrence` (`slot_id`,`original_starts_at_utc`);--> statement-breakpoint
CREATE TABLE `show` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `show_slug_unique` ON `show` (`slug`);--> statement-breakpoint
CREATE TABLE `slot` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`station_id` text NOT NULL,
	`show_id` integer,
	`kind` text NOT NULL,
	`title` text,
	`rrule` text,
	`start_wall` text NOT NULL,
	`duration_min` integer NOT NULL,
	`negotiation_default` text DEFAULT 'prebooked' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `show`(`id`) ON UPDATE no action ON DELETE no action
);
