CREATE TABLE `day_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` text NOT NULL,
	`day` integer NOT NULL,
	`place` text NOT NULL,
	`url` text NOT NULL,
	`source_type` text NOT NULL,
	`object_key` text
);
