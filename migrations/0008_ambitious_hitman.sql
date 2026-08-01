CREATE TYPE "public"."discovered_match_status" AS ENUM('PENDING', 'UNAVAILABLE');--> statement-breakpoint
ALTER TABLE "discovered_matches" ADD COLUMN "status" "discovered_match_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "discovered_matches" ADD COLUMN "unavailable_reason" text;--> statement-breakpoint
ALTER TABLE "patches" ADD COLUMN "active_publication_id" uuid;--> statement-breakpoint
ALTER TABLE "discovered_matches" ADD CONSTRAINT "discovered_matches_unavailable_reason_safe" CHECK ("discovered_matches"."unavailable_reason" IS NULL OR "discovered_matches"."unavailable_reason" = 'not_found');--> statement-breakpoint
ALTER TABLE "discovered_matches" ADD CONSTRAINT "discovered_matches_unavailable_reason_state" CHECK (("discovered_matches"."status" = 'UNAVAILABLE' AND "discovered_matches"."unavailable_reason" IS NOT NULL) OR ("discovered_matches"."status" = 'PENDING' AND "discovered_matches"."unavailable_reason" IS NULL));