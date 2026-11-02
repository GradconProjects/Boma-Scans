CREATE TABLE `telegram_runtime` (
	`id` text PRIMARY KEY NOT NULL,
	`offset` integer NOT NULL,
	`lease_until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`id` integer PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL
);
