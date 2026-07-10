CREATE TABLE `broadcaster_session` (
	`id` text PRIMARY KEY NOT NULL,
	`broadcaster_id` integer NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`broadcaster_id`) REFERENCES `broadcaster`(`id`) ON UPDATE no action ON DELETE cascade
);
