CREATE TYPE "public"."item_category" AS ENUM('CORE', 'BOOTS', 'EXCLUDED_COMPONENT', 'EXCLUDED_STARTER', 'EXCLUDED_CONSUMABLE', 'EXCLUDED_TRINKET', 'EXCLUDED_SUPPORT', 'EXCLUDED_MODE', 'EXCLUDED_UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER');--> statement-breakpoint
CREATE TYPE "public"."validation_state" AS ENUM('PENDING', 'VALID', 'INVALID', 'REJECTED');--> statement-breakpoint
CREATE TABLE "aggregate_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patch_id" integer NOT NULL,
	"run_id" uuid NOT NULL,
	"coverage_started_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"minimum_sample" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aggregate_publications_minimum_sample_nonnegative" CHECK ("aggregate_publications"."minimum_sample" >= 0)
);
--> statement-breakpoint
CREATE TABLE "boots_aggregates" (
	"publication_id" uuid NOT NULL,
	"champion_id" integer NOT NULL,
	"role" "role" NOT NULL,
	"item_id" integer NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"sample" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "boots_aggregates_publication_id_champion_id_role_item_id_pk" PRIMARY KEY("publication_id","champion_id","role","item_id"),
	CONSTRAINT "boots_aggregates_counts_nonnegative" CHECK ("boots_aggregates"."wins" >= 0 AND "boots_aggregates"."losses" >= 0 AND "boots_aggregates"."sample" >= 0)
);
--> statement-breakpoint
CREATE TABLE "champions" (
	"patch_id" integer NOT NULL,
	"champion_id" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"icon_url" text NOT NULL,
	"splash_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "champions_patch_id_champion_id_pk" PRIMARY KEY("patch_id","champion_id"),
	CONSTRAINT "champions_patch_slug_unique" UNIQUE("patch_id","slug")
);
--> statement-breakpoint
CREATE TABLE "collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "run_status" DEFAULT 'PENDING' NOT NULL,
	"stage" text DEFAULT 'discovery' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"matches_discovered" integer DEFAULT 0 NOT NULL,
	"matches_ingested" integer DEFAULT 0 NOT NULL,
	"observations_accepted" integer DEFAULT 0 NOT NULL,
	"observations_rejected" integer DEFAULT 0 NOT NULL,
	"error_details" jsonb,
	"publication_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "combination_aggregates" (
	"publication_id" uuid NOT NULL,
	"champion_id" integer NOT NULL,
	"role" "role" NOT NULL,
	"size" integer NOT NULL,
	"combination_key" text NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"sample" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "combination_aggregates_publication_id_champion_id_role_size_combination_key_pk" PRIMARY KEY("publication_id","champion_id","role","size","combination_key"),
	CONSTRAINT "combination_aggregates_size_valid" CHECK ("combination_aggregates"."size" IN (2, 3))
);
--> statement-breakpoint
CREATE TABLE "item_aggregates" (
	"publication_id" uuid NOT NULL,
	"champion_id" integer NOT NULL,
	"role" "role" NOT NULL,
	"item_id" integer NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"sample" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "item_aggregates_publication_id_champion_id_role_item_id_pk" PRIMARY KEY("publication_id","champion_id","role","item_id"),
	CONSTRAINT "item_aggregates_counts_nonnegative" CHECK ("item_aggregates"."wins" >= 0 AND "item_aggregates"."losses" >= 0 AND "item_aggregates"."sample" >= 0)
);
--> statement-breakpoint
CREATE TABLE "items" (
	"patch_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"normalized_base_id" integer NOT NULL,
	"category" "item_category" NOT NULL,
	"classification_reason" text NOT NULL,
	"name" text NOT NULL,
	"price" integer NOT NULL,
	"icon_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_patch_id_item_id_pk" PRIMARY KEY("patch_id","item_id"),
	CONSTRAINT "items_price_nonnegative" CHECK ("items"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ladder_snapshots" (
	"run_id" uuid NOT NULL,
	"puuid" text NOT NULL,
	"queue" integer DEFAULT 420 NOT NULL,
	"tier" "tier" NOT NULL,
	"division" varchar(3) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ladder_snapshots_run_id_puuid_pk" PRIMARY KEY("run_id","puuid")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"match_id" text PRIMARY KEY NOT NULL,
	"patch_id" integer NOT NULL,
	"platform_id" text NOT NULL,
	"queue_id" integer NOT NULL,
	"game_version" text NOT NULL,
	"game_creation" timestamp with time zone NOT NULL,
	"game_duration" integer NOT NULL,
	"validation_state" "validation_state" DEFAULT 'PENDING' NOT NULL,
	"validation_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_duration_nonnegative" CHECK ("matches"."game_duration" >= 0)
);
--> statement-breakpoint
CREATE TABLE "participant_boots" (
	"match_id" text NOT NULL,
	"participant_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"slot_index" integer,
	CONSTRAINT "participant_boots_match_id_participant_id_pk" PRIMARY KEY("match_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "participant_core_items" (
	"match_id" text NOT NULL,
	"participant_id" integer NOT NULL,
	"slot_index" integer NOT NULL,
	"item_id" integer NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "participant_core_items_match_id_participant_id_slot_index_pk" PRIMARY KEY("match_id","participant_id","slot_index"),
	CONSTRAINT "participant_core_items_slot_nonnegative" CHECK ("participant_core_items"."slot_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "participant_observations" (
	"match_id" text NOT NULL,
	"participant_id" integer NOT NULL,
	"patch_id" integer NOT NULL,
	"puuid" text NOT NULL,
	"champion_id" integer NOT NULL,
	"role" "role" NOT NULL,
	"win" boolean NOT NULL,
	"tier" "tier" NOT NULL,
	"division" varchar(3) NOT NULL,
	"game_duration" integer NOT NULL,
	"raw_final_slots" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_observations_match_id_participant_id_pk" PRIMARY KEY("match_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "patches" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"patch_key" text NOT NULL,
	"activated_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patches_version_unique" UNIQUE("version"),
	CONSTRAINT "patches_version_nonempty" CHECK (length("patches"."version") > 0)
);
--> statement-breakpoint
ALTER TABLE "aggregate_publications" ADD CONSTRAINT "aggregate_publications_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aggregate_publications" ADD CONSTRAINT "aggregate_publications_run_id_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."collection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boots_aggregates" ADD CONSTRAINT "boots_aggregates_publication_id_aggregate_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."aggregate_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "champions" ADD CONSTRAINT "champions_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combination_aggregates" ADD CONSTRAINT "combination_aggregates_publication_id_aggregate_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."aggregate_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_aggregates" ADD CONSTRAINT "item_aggregates_publication_id_aggregate_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."aggregate_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ladder_snapshots" ADD CONSTRAINT "ladder_snapshots_run_id_collection_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."collection_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_observations" ADD CONSTRAINT "participant_observations_match_id_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("match_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_observations" ADD CONSTRAINT "participant_observations_patch_id_patches_id_fk" FOREIGN KEY ("patch_id") REFERENCES "public"."patches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aggregate_publications_one_active_idx" ON "aggregate_publications" USING btree ("is_active") WHERE "aggregate_publications"."is_active" = true;--> statement-breakpoint
CREATE INDEX "collection_runs_status_started_at_idx" ON "collection_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "ladder_snapshots_run_tier_idx" ON "ladder_snapshots" USING btree ("run_id","tier");--> statement-breakpoint
CREATE INDEX "matches_patch_validation_idx" ON "matches" USING btree ("patch_id","validation_state");--> statement-breakpoint
CREATE INDEX "participant_observations_patch_champion_role_idx" ON "participant_observations" USING btree ("patch_id","champion_id","role");