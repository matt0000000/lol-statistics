ALTER TYPE "public"."discovered_match_status" ADD VALUE 'PROCESSED' BEFORE 'UNAVAILABLE';--> statement-breakpoint
ALTER TABLE "discovered_matches" DROP CONSTRAINT IF EXISTS "discovered_matches_unavailable_reason_state";--> statement-breakpoint
ALTER TABLE "discovered_matches" ADD CONSTRAINT "discovered_matches_unavailable_reason_state"
  CHECK (("status" = 'UNAVAILABLE' AND "unavailable_reason" IS NOT NULL)
      OR ("status" IN ('PENDING', 'PROCESSED') AND "unavailable_reason" IS NULL));
