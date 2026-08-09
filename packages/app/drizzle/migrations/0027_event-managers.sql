CREATE TABLE `event_managers` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`added_by_actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`added_by_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_managers_event_actor_unique` ON `event_managers` (`event_id`,`actor_id`);--> statement-breakpoint
CREATE INDEX `event_managers_event_idx` ON `event_managers` (`event_id`);