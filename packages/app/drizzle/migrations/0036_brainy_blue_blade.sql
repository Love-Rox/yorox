ALTER TABLE `users` ADD `discord_dm_notifications` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `discord_webhook_url` text;