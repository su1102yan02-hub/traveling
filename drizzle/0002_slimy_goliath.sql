CREATE TABLE `trip_archives` (
	`id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`destination` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`archived_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trip_settings` (
	`trip_id` text PRIMARY KEY NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`updated_at` text NOT NULL
);
