ALTER TABLE `events` ADD `remote_join_methods` text DEFAULT '["reply","join"]' NOT NULL;--> statement-breakpoint
ALTER TABLE `slots` ADD `allow_remote` integer DEFAULT false NOT NULL;