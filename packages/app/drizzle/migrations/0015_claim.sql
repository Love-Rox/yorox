CREATE TABLE `claim_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_actor_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_codes_hash_unique` ON `claim_codes` (`code_hash`);--> statement-breakpoint
ALTER TABLE `actors` ADD `claimed_by_actor_id` text;