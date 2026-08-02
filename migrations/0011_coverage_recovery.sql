ALTER TABLE "collection_runs" ADD COLUMN "coverage_started_at" timestamp with time zone;--> statement-breakpoint
UPDATE "collection_runs"
SET "coverage_started_at" = "started_at" - ("coverage_days" * interval '1 day');--> statement-breakpoint
ALTER TABLE "collection_runs" ALTER COLUMN "coverage_started_at" SET DEFAULT (now() - interval '35 days');--> statement-breakpoint
ALTER TABLE "collection_runs" ALTER COLUMN "coverage_started_at" SET NOT NULL;
