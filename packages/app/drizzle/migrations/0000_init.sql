CREATE TABLE `action_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer,
	`responded_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `action_requests_actor_status_idx` ON `action_requests` (`actor_id`,`status`);--> statement-breakpoint
CREATE TABLE `actors` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`handle` text,
	`domain` text,
	`uri` text NOT NULL,
	`inbox_url` text,
	`shared_inbox_url` text,
	`display_name` text NOT NULL,
	`summary` text,
	`avatar_url` text,
	`moved_to_actor_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `actors_uri_unique` ON `actors` (`uri`);--> statement-breakpoint
CREATE UNIQUE INDEX `actors_handle_domain_unique` ON `actors` (`handle`,`domain`);--> statement-breakpoint
CREATE INDEX `actors_kind_idx` ON `actors` (`kind`);--> statement-breakpoint
CREATE TABLE `attendances` (
	`participation_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`recorded_by_actor_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`participation_id`) REFERENCES `participations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `domain_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `domain_events_unprocessed_idx` ON `domain_events` (`processed_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `event_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`title` text NOT NULL,
	`description_md` text,
	`speaker_actor_id` text,
	`speaker_name` text,
	`starts_at` integer,
	`ends_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`speaker_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_sessions_event_idx` ON `event_sessions` (`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`group_actor_id` text NOT NULL,
	`title` text NOT NULL,
	`description_md` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`timezone` text DEFAULT 'Asia/Tokyo' NOT NULL,
	`venue_name` text,
	`venue_address` text,
	`online_url` text,
	`visibility` text DEFAULT 'draft' NOT NULL,
	`participant_list_public` integer DEFAULT true NOT NULL,
	`published_at` integer,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_actor_id`) REFERENCES `groups`(`actor_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_group_idx` ON `events` (`group_actor_id`);--> statement-breakpoint
CREATE INDEX `events_starts_at_idx` ON `events` (`starts_at`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_actor_id` text NOT NULL,
	`member_actor_id` text NOT NULL,
	`role_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`group_actor_id`, `member_actor_id`),
	FOREIGN KEY (`group_actor_id`) REFERENCES `groups`(`actor_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `group_roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `group_members_member_idx` ON `group_members` (`member_actor_id`);--> statement-breakpoint
CREATE TABLE `group_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`group_actor_id` text NOT NULL,
	`name` text NOT NULL,
	`permissions` text NOT NULL,
	`is_preset` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_actor_id`) REFERENCES `groups`(`actor_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `group_roles_group_idx` ON `group_roles` (`group_actor_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`actor_id` text PRIMARY KEY NOT NULL,
	`is_personal` integer DEFAULT false NOT NULL,
	`description_md` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`session_id` text,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`created_by_actor_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `event_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `materials_event_idx` ON `materials` (`event_id`);--> statement-breakpoint
CREATE TABLE `participations` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`status` text NOT NULL,
	`hidden_from_list` integer DEFAULT false NOT NULL,
	`applied_at` integer NOT NULL,
	`decided_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participations_slot_actor_unique` ON `participations` (`slot_id`,`actor_id`);--> statement-breakpoint
CREATE INDEX `participations_actor_idx` ON `participations` (`actor_id`);--> statement-breakpoint
CREATE INDEX `participations_slot_status_idx` ON `participations` (`slot_id`,`status`);--> statement-breakpoint
CREATE TABLE `slots` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`capacity` integer NOT NULL,
	`method` text NOT NULL,
	`waitlist_model` text DEFAULT 'connpass' NOT NULL,
	`waitlist_capacity` integer,
	`promotion_policy` text DEFAULT 'auto' NOT NULL,
	`promotion_deadline_hours` integer,
	`lottery_logic` text,
	`lottery_at` integer,
	`conditions` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `slots_event_idx` ON `slots` (`event_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`actor_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);