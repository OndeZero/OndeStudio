CREATE TABLE `ac_now_cache` (
	`station_id` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`observed_at` text NOT NULL
);
