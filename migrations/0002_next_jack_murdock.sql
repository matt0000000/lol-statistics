CREATE TABLE "discovered_matches" (
	"run_id" uuid NOT NULL,
	"match_id" text NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovered_matches_run_id_match_id_pk" PRIMARY KEY("run_id","match_id")
);
--> statement-breakpoint
ALTER TABLE "ladder_snapshots" ADD COLUMN "next_match_offset" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "discovered_matches" ADD CONSTRAINT "discovered_matches_run_id_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."collection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovered_matches_run_idx" ON "discovered_matches" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "ladder_snapshots" ADD CONSTRAINT "ladder_snapshots_next_match_offset_nonnegative" CHECK ("ladder_snapshots"."next_match_offset" >= 0);