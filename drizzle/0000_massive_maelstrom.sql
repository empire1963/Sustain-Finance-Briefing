CREATE TABLE `refresh_lease` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_cache` (
	`source_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`checked_at` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`error` text
);
