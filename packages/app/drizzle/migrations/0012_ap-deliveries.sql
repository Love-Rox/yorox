CREATE TABLE `ap_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`signer_actor_id` text NOT NULL,
	`inbox_url` text NOT NULL,
	`activity_json` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`last_error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`signer_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ap_deliveries_pending_idx` ON `ap_deliveries` (`sent_at`,`next_attempt_at`);