CREATE TABLE `follows` (
	`id` text PRIMARY KEY NOT NULL,
	`follower_actor_id` text NOT NULL,
	`followed_actor_id` text NOT NULL,
	`activity_uri` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`follower_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`followed_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follows_pair_unique` ON `follows` (`follower_actor_id`,`followed_actor_id`);--> statement-breakpoint
CREATE INDEX `follows_followed_idx` ON `follows` (`followed_actor_id`);