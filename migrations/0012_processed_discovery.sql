ALTER TABLE "public"."discovered_matches" DROP CONSTRAINT "discovered_matches_unavailable_reason_state";--> statement-breakpoint
ALTER TABLE "public"."discovered_matches" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
CREATE TYPE "public"."discovered_match_status_new" AS ENUM('PENDING', 'PROCESSED', 'UNAVAILABLE');--> statement-breakpoint
ALTER TABLE "public"."discovered_matches" ALTER COLUMN "status" TYPE "public"."discovered_match_status_new" USING "status"::text::"public"."discovered_match_status_new";--> statement-breakpoint
DROP TYPE "public"."discovered_match_status";--> statement-breakpoint
ALTER TYPE "public"."discovered_match_status_new" RENAME TO "discovered_match_status";--> statement-breakpoint
ALTER TABLE "public"."discovered_matches" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"public"."discovered_match_status";--> statement-breakpoint
ALTER TABLE "public"."discovered_matches" ADD CONSTRAINT "discovered_matches_unavailable_reason_state"
  CHECK (("status" = 'UNAVAILABLE'::"public"."discovered_match_status" AND "unavailable_reason" IS NOT NULL)
      OR ("status" IN ('PENDING'::"public"."discovered_match_status", 'PROCESSED'::"public"."discovered_match_status") AND "unavailable_reason" IS NULL));
