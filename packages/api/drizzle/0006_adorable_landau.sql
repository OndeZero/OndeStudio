CREATE TABLE `projection` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`os_object_type` text NOT NULL,
	`os_object_id` integer NOT NULL,
	`station_id` text NOT NULL,
	`az_kind` text NOT NULL,
	`az_id` text,
	`tag_marker` text NOT NULL,
	`last_pushed_json` text,
	`last_seen_json` text,
	`reconcile_state` text DEFAULT 'synced' NOT NULL,
	`last_synced_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projection_os_object_type_os_object_id_station_id_unique` ON `projection` (`os_object_type`,`os_object_id`,`station_id`);--> statement-breakpoint
CREATE TABLE `reconciliation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`projection_id` integer NOT NULL,
	`kind` text NOT NULL,
	`summary` text NOT NULL,
	`detail_json` text NOT NULL,
	`detected_at` text NOT NULL,
	`resolved_at` text,
	`resolution` text,
	FOREIGN KEY (`projection_id`) REFERENCES `projection`(`id`) ON UPDATE no action ON DELETE cascade
);
