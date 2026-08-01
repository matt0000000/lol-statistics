CREATE TYPE "public"."rejection_reason" AS ENUM('platform', 'queue', 'patch', 'rank', 'role', 'remake', 'duration', 'required_field', 'unknown_item', 'invalid_item');--> statement-breakpoint
CREATE TABLE "participant_rejections" (
	"match_id" text NOT NULL,
	"participant_id" integer NOT NULL,
	"patch_id" integer NOT NULL,
	"reason" "rejection_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_rejections_match_id_participant_id_pk" PRIMARY KEY("match_id","participant_id")
);
--> statement-breakpoint
ALTER TABLE "participant_rejections" ADD CONSTRAINT "participant_rejections_match_id_patch_id_matches_match_id_patch_id_fk" FOREIGN KEY ("match_id","patch_id") REFERENCES "public"."matches"("match_id","patch_id") ON DELETE no action ON UPDATE no action;