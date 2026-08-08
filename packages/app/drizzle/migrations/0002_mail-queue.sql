CREATE TABLE `mail_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`body_text` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`scheduled_at` integer NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_queue_pending_idx` ON `mail_queue` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `mail_queue_sent_at_idx` ON `mail_queue` (`sent_at`);