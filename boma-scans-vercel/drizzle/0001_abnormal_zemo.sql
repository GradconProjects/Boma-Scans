CREATE TABLE `telegram_deliveries` (
	`user_id` text NOT NULL,
	`signal_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `signal_key`)
);
