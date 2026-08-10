CREATE TABLE `email_change_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_actor_id` text NOT NULL,
	`new_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_actor_id`) REFERENCES `users`(`actor_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_change_tokens_token_hash_unique` ON `email_change_tokens` (`token_hash`);