CREATE TYPE "public"."discovered_match_status" AS ENUM('PENDING', 'UNAVAILABLE');--> statement-breakpoint
ALTER TABLE "discovered_matches" ADD COLUMN "status" "discovered_match_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "discovered_matches" ADD COLUMN "unavailable_reason" text;--> statement-breakpoint
ALTER TABLE "patches" ADD COLUMN "active_publication_id" uuid;--> statement-breakpoint
UPDATE patches SET active_publication_id = NULL;--> statement-breakpoint
-- The pointer is nullable so this migration can be applied before any
-- publication exists. Select the one globally active publication
-- deterministically, then only bind it to its still-active patch.
WITH active_publication AS (
  SELECT ap.id, ap.patch_id
  FROM aggregate_publications ap
  WHERE ap.is_active = true
  ORDER BY ap.created_at, ap.id
  LIMIT 1
)
UPDATE patches p
SET active_publication_id = ap.id
FROM active_publication ap
WHERE p.id = ap.patch_id AND p.is_active = true;--> statement-breakpoint
-- Any pointer that does not describe the global active publication on the
-- current patch is stale and must not survive the upgrade.
UPDATE patches p
SET active_publication_id = NULL
WHERE p.active_publication_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM aggregate_publications ap
    WHERE ap.id = p.active_publication_id
      AND ap.is_active = true
      AND p.is_active = true
      AND ap.patch_id = p.id
  );--> statement-breakpoint
ALTER TABLE "discovered_matches" ADD CONSTRAINT "discovered_matches_unavailable_reason_safe" CHECK ("discovered_matches"."unavailable_reason" IS NULL OR "discovered_matches"."unavailable_reason" = 'not_found');--> statement-breakpoint
ALTER TABLE "discovered_matches" ADD CONSTRAINT "discovered_matches_unavailable_reason_state" CHECK (("discovered_matches"."status" = 'UNAVAILABLE' AND "discovered_matches"."unavailable_reason" IS NOT NULL) OR ("discovered_matches"."status" = 'PENDING' AND "discovered_matches"."unavailable_reason" IS NULL));
