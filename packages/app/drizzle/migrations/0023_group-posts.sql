CREATE TABLE `group_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`group_actor_id` text NOT NULL,
	`author_actor_id` text NOT NULL,
	`body_md` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `group_posts_group_idx` ON `group_posts` (`group_actor_id`,`created_at`);