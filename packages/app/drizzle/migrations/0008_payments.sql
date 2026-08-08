CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`participation_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'JPY' NOT NULL,
	`method` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider` text,
	`provider_ref` text,
	`marked_by_actor_id` text,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`participation_id`) REFERENCES `participations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marked_by_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_participation_unique` ON `payments` (`participation_id`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`);--> statement-breakpoint
ALTER TABLE `slots` ADD `price` integer;--> statement-breakpoint
ALTER TABLE `slots` ADD `currency` text DEFAULT 'JPY' NOT NULL;--> statement-breakpoint
ALTER TABLE `slots` ADD `payment_method` text;--> statement-breakpoint
ALTER TABLE `slots` ADD `payment_url` text;--> statement-breakpoint
ALTER TABLE `slots` ADD `payment_confirm` text DEFAULT 'independent' NOT NULL;