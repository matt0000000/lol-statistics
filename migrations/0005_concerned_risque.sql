CREATE TABLE "baseline_aggregates" (
	"publication_id" uuid NOT NULL,
	"champion_id" integer NOT NULL,
	"role" "role" NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"sample" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "baseline_aggregates_publication_id_champion_id_role_pk" PRIMARY KEY("publication_id","champion_id","role"),
	CONSTRAINT "baseline_aggregates_counts_nonnegative" CHECK ("baseline_aggregates"."wins" >= 0 AND "baseline_aggregates"."losses" >= 0 AND "baseline_aggregates"."sample" >= 0),
	CONSTRAINT "baseline_aggregates_counts_equal" CHECK ("baseline_aggregates"."wins" + "baseline_aggregates"."losses" = "baseline_aggregates"."sample")
);
--> statement-breakpoint
ALTER TABLE "baseline_aggregates" ADD CONSTRAINT "baseline_aggregates_publication_id_aggregate_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."aggregate_publications"("id") ON DELETE no action ON UPDATE no action;