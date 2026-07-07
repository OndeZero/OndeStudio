CREATE TABLE `episode` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer NOT NULL,
	`az_file_id` text NOT NULL,
	`path` text NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`duration_sec` integer,
	`queue_order` integer DEFAULT 0 NOT NULL,
	`arrived_at` text NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `show`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episode_show_id_az_file_id_unique` ON `episode` (`show_id`,`az_file_id`);--> statement-breakpoint
ALTER TABLE `occurrence` ADD `episode_id` integer REFERENCES episode(id);