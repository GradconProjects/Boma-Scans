CREATE TABLE `account_records` (
	`user_id` text NOT NULL,
	`record_key` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `record_key`)
);
