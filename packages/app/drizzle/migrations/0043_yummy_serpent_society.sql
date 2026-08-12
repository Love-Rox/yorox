ALTER TABLE `events` ADD `application_survey` text;--> statement-breakpoint
ALTER TABLE `events` ADD `survey_remote_policy` text DEFAULT 'exempt' NOT NULL;--> statement-breakpoint
ALTER TABLE `participations` ADD `survey_answers` text;--> statement-breakpoint
ALTER TABLE `slots` ADD `application_survey` text;