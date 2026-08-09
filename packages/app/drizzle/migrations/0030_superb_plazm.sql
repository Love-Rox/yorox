CREATE TABLE `group_blocks` (
	`group_actor_id` text NOT NULL,
	`blocked_actor_id` text NOT NULL,
	`reason` text,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`group_actor_id`, `blocked_actor_id`),
	FOREIGN KEY (`group_actor_id`) REFERENCES `groups`(`actor_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blocked_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `group_blocks_blocked_idx` ON `group_blocks` (`blocked_actor_id`);