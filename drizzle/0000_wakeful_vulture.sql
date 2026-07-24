CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`amount` real NOT NULL,
	`time` text NOT NULL,
	`day` integer NOT NULL,
	`created_by` text DEFAULT '我' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` integer PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`time` text NOT NULL,
	`title` text NOT NULL,
	`place` text NOT NULL,
	`day` integer NOT NULL,
	`done` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trip_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trip_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`last_seen` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`share_code` text NOT NULL,
	`title` text NOT NULL,
	`destination` text NOT NULL,
	`budget` real NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trips_share_code_unique` ON `trips` (`share_code`);