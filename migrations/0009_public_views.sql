-- Public views are the only relation surface the web reader needs. Deploy the
-- web process with a role that has SELECT on these views only, for example:
--   CREATE ROLE lol_web_reader LOGIN PASSWORD '...';
--   GRANT USAGE ON SCHEMA public TO lol_web_reader;
--   GRANT SELECT ON public_active_publication, public_champions,
--     public_item_metadata, public_champion_role_baselines, public_item_stats,
--     public_combination_stats, public_boots_stats TO lol_web_reader;
-- Do not grant the reader access to canonical/private tables.

CREATE VIEW "public_active_publication"
WITH (security_barrier = true)
AS
SELECT
  ap.id AS publication_id,
  p.id AS patch_id,
  p.version AS patch_version,
  p.patch_key,
  ap.coverage_started_at,
  ap.collected_at,
  p.published_at,
  ap.minimum_sample,
  cr.status AS run_status,
  cr.stage,
  cr.matches_discovered,
  cr.matches_ingested,
  cr.observations_accepted,
  cr.observations_rejected
FROM aggregate_publications ap
JOIN patches p
  ON p.id = ap.patch_id
 AND p.is_active = true
 AND p.active_publication_id = ap.id
JOIN collection_runs cr ON cr.id = ap.run_id
WHERE ap.is_active = true;
--> statement-breakpoint

CREATE VIEW "public_champions"
WITH (security_barrier = true)
AS
SELECT c.patch_id, c.champion_id, c.slug, c.name, c.icon_url, c.splash_url
FROM champions c
JOIN public_active_publication ap ON ap.patch_id = c.patch_id;
--> statement-breakpoint

CREATE VIEW "public_item_metadata"
WITH (security_barrier = true)
AS
SELECT DISTINCT ON (i.patch_id, i.normalized_base_id)
  i.patch_id, i.item_id, i.normalized_base_id, i.category, i.name, i.icon_url
FROM items i
JOIN public_active_publication ap ON ap.patch_id = i.patch_id
WHERE i.category IN ('CORE', 'BOOTS')
ORDER BY i.patch_id, i.normalized_base_id, i.item_id;
--> statement-breakpoint

CREATE VIEW "public_champion_role_baselines"
WITH (security_barrier = true)
AS
SELECT
  b.publication_id,
  b.champion_id,
  b.role,
  b.wins,
  b.losses,
  b.sample
FROM baseline_aggregates b
JOIN public_active_publication ap ON ap.publication_id = b.publication_id
WHERE b.wins + b.losses = b.sample;
--> statement-breakpoint

CREATE VIEW "public_item_stats"
WITH (security_barrier = true)
AS
SELECT
  a.publication_id,
  a.champion_id,
  a.role,
  a.item_id,
  a.wins,
  a.losses,
  a.sample,
  b.wins AS baseline_wins,
  b.losses AS baseline_losses,
  b.sample AS baseline_sample,
  i.name AS item_name,
  i.icon_url AS item_icon_url,
  jsonb_build_array(jsonb_build_object('id', i.normalized_base_id, 'name', i.name, 'iconUrl', i.icon_url)) AS item_metadata,
  ARRAY[a.item_id]::integer[] AS item_ids,
  a.item_id::text AS stat_key
FROM item_aggregates a
JOIN public_active_publication ap ON ap.publication_id = a.publication_id
JOIN public_champion_role_baselines b
  ON b.publication_id = a.publication_id
 AND b.champion_id = a.champion_id
 AND b.role = a.role
JOIN public_item_metadata i
  ON i.patch_id = ap.patch_id
 AND i.normalized_base_id = a.item_id
WHERE a.wins + a.losses = a.sample
  AND a.sample <= b.sample;
--> statement-breakpoint

CREATE VIEW "public_combination_stats"
WITH (security_barrier = true)
AS
SELECT
  a.publication_id,
  a.champion_id,
  a.role,
  a.size,
  a.combination_key AS stat_key,
  ARRAY(SELECT value::integer FROM unnest(string_to_array(a.combination_key, ':')) AS value)::integer[] AS item_ids,
  a.wins,
  a.losses,
  a.sample,
  b.wins AS baseline_wins,
  b.losses AS baseline_losses,
  b.sample AS baseline_sample,
  (
    SELECT jsonb_agg(jsonb_build_object('id', m.normalized_base_id, 'name', m.name, 'iconUrl', m.icon_url) ORDER BY u.ordinality)
    FROM unnest(ARRAY(SELECT value::integer FROM unnest(string_to_array(a.combination_key, ':')) AS value)::integer[]) WITH ORDINALITY AS u(item_id, ordinality)
    JOIN public_item_metadata m ON m.patch_id = ap.patch_id AND m.normalized_base_id = u.item_id
  ) AS item_metadata
FROM combination_aggregates a
JOIN public_active_publication ap ON ap.publication_id = a.publication_id
JOIN public_champion_role_baselines b
  ON b.publication_id = a.publication_id
 AND b.champion_id = a.champion_id
 AND b.role = a.role
WHERE a.size IN (2, 3)
  AND a.wins + a.losses = a.sample
  AND a.sample <= b.sample
  AND a.combination_key ~ '^[0-9]+(:[0-9]+){1,2}$'
  AND a.combination_key = (
    SELECT string_agg(value, ':' ORDER BY value::integer)
    FROM unnest(string_to_array(a.combination_key, ':')) AS value
  );
--> statement-breakpoint

CREATE VIEW "public_boots_stats"
WITH (security_barrier = true)
AS
SELECT
  a.publication_id,
  a.champion_id,
  a.role,
  a.item_id,
  a.wins,
  a.losses,
  a.sample,
  b.wins AS baseline_wins,
  b.losses AS baseline_losses,
  b.sample AS baseline_sample,
  i.name AS item_name,
  i.icon_url AS item_icon_url,
  jsonb_build_array(jsonb_build_object('id', i.normalized_base_id, 'name', i.name, 'iconUrl', i.icon_url)) AS item_metadata,
  ARRAY[a.item_id]::integer[] AS item_ids,
  a.item_id::text AS stat_key
FROM boots_aggregates a
JOIN public_active_publication ap ON ap.publication_id = a.publication_id
JOIN public_champion_role_baselines b
  ON b.publication_id = a.publication_id
 AND b.champion_id = a.champion_id
 AND b.role = a.role
JOIN public_item_metadata i
  ON i.patch_id = ap.patch_id
 AND i.normalized_base_id = a.item_id
 AND i.category = 'BOOTS'
WHERE a.wins + a.losses = a.sample
  AND a.sample <= b.sample;
--> statement-breakpoint

COMMENT ON VIEW public_active_publication IS 'Current patch publication only; active pointer and global active flag must agree.';
COMMENT ON VIEW public_champions IS 'Public champion catalog; no player or match identifiers.';
COMMENT ON VIEW public_item_metadata IS 'Public active-patch item catalog for aggregate responses.';
COMMENT ON VIEW public_champion_role_baselines IS 'Published champion-role aggregate baseline.';
COMMENT ON VIEW public_item_stats IS 'Published item aggregate joined to its baseline.';
COMMENT ON VIEW public_combination_stats IS 'Published unordered pair/trio aggregate; combination_key is canonical numeric order.';
COMMENT ON VIEW public_boots_stats IS 'Published upgraded-boots aggregate, separate from core items.';
