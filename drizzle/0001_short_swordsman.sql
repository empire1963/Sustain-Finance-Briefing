CREATE TABLE `reader_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`preferences` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_stories` (
	`user_id` text NOT NULL,
	`article_url` text NOT NULL,
	`payload` text NOT NULL,
	`saved_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `article_url`)
);
