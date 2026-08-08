ALTER TABLE `ap_deliveries` ADD `activity_uri` text;--> statement-breakpoint
CREATE UNIQUE INDEX `ap_deliveries_activity_inbox_unique` ON `ap_deliveries` (`activity_uri`,`inbox_url`);