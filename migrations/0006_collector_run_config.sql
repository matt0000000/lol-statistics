UPDATE "collection_runs" SET "stage" = CASE lower("stage") WHEN 'snapshot' THEN 'ladder' WHEN 'ingest' THEN 'matches' WHEN 'aggregate' THEN 'aggregates' ELSE lower("stage") END;--> statement-breakpoint
ALTER TABLE "collection_runs" ALTER COLUMN "stage" SET DEFAULT 'catalog';--> statement-breakpoint
ALTER TABLE "collection_runs" ADD COLUMN "patch_id" integer;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD COLUMN "coverage_days" integer DEFAULT 35 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD COLUMN "minimum_sample" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_coverage_days_positive" CHECK ("collection_runs"."coverage_days" > 0);--> statement-breakpoint
ALTER TABLE "collection_runs" ADD CONSTRAINT "collection_runs_minimum_sample_nonnegative" CHECK ("collection_runs"."minimum_sample" >= 0);
