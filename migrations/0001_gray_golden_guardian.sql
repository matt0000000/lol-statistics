ALTER TABLE "participant_observations" DROP CONSTRAINT "participant_observations_match_id_matches_match_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_match_id_patch_id_unique" UNIQUE("match_id","patch_id");--> statement-breakpoint
ALTER TABLE "participant_observations" ADD CONSTRAINT "participant_observations_match_id_patch_id_matches_match_id_patch_id_fk" FOREIGN KEY ("match_id","patch_id") REFERENCES "public"."matches"("match_id","patch_id") ON DELETE no action ON UPDATE no action;
