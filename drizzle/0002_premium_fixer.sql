CREATE TABLE `collector_state` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`checked_at` integer NOT NULL
);
