-- Repair historical duplicates before enforcing the ownership invariant. Keep
-- an active target in preference to an inactive one, then the oldest target.
-- Unpublished duplicate aggregate rows are disposable staging data; canonical
-- active data is never removed. Rebind the run before deleting its orphan.
DO $$
DECLARE duplicate RECORD;
BEGIN
  FOR duplicate IN
    SELECT p.id, p.run_id,
      first_value(p.id) OVER (PARTITION BY p.run_id ORDER BY p.is_active DESC, p.created_at, p.id) AS keeper
    FROM aggregate_publications p
  LOOP
    IF duplicate.id <> duplicate.keeper THEN
      UPDATE collection_runs SET publication_id = duplicate.keeper WHERE id = duplicate.run_id AND publication_id = duplicate.id;
      DELETE FROM baseline_aggregates WHERE publication_id = duplicate.id;
      DELETE FROM item_aggregates WHERE publication_id = duplicate.id;
      DELETE FROM combination_aggregates WHERE publication_id = duplicate.id;
      DELETE FROM boots_aggregates WHERE publication_id = duplicate.id;
      DELETE FROM aggregate_publications WHERE id = duplicate.id;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS aggregate_publications_one_per_run_idx ON aggregate_publications (run_id);
