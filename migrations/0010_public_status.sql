-- Single public-safe status snapshot. It deliberately contains no player,
-- match, ladder, raw observation, or private error fields.
CREATE VIEW "public_status"
WITH (security_barrier = true)
AS
WITH current_patch AS (
  SELECT p.* FROM patches p WHERE p.is_active = true ORDER BY p.id DESC LIMIT 1
), latest_run AS (
  SELECT DISTINCT ON (cr.patch_id) cr.*
  FROM collection_runs cr JOIN current_patch p ON p.id = cr.patch_id
  ORDER BY cr.patch_id, cr.updated_at DESC, cr.started_at DESC
), active_pub AS (
  SELECT ap.* FROM aggregate_publications ap JOIN current_patch p ON p.active_publication_id = ap.id
  WHERE ap.is_active = true
), role_samples AS (
  SELECT b.publication_id,
    COALESCE(SUM(b.sample) FILTER (WHERE b.role = 'TOP'), 0)::integer AS top_sample,
    COALESCE(SUM(b.sample) FILTER (WHERE b.role = 'JUNGLE'), 0)::integer AS jungle_sample,
    COALESCE(SUM(b.sample) FILTER (WHERE b.role = 'MIDDLE'), 0)::integer AS middle_sample,
    COALESCE(SUM(b.sample) FILTER (WHERE b.role = 'BOTTOM'), 0)::integer AS bottom_sample,
    COALESCE(SUM(b.sample) FILTER (WHERE b.role = 'UTILITY'), 0)::integer AS utility_sample
  FROM baseline_aggregates b GROUP BY b.publication_id
)
SELECT p.version AS patch_version, p.patch_key,
  COALESCE(ap.coverage_started_at, cr.started_at) AS coverage_started_at,
  p.published_at,
  CASE WHEN p.published_at IS NULL THEN NULL ELSE GREATEST(0, EXTRACT(EPOCH FROM (now() - p.published_at)))::bigint END AS publication_age_seconds,
  CASE WHEN ap.id IS NULL THEN 'warming'
       WHEN p.published_at IS NULL OR p.published_at > now() THEN 'warming'
       WHEN now() - p.published_at <= interval '6 hours' THEN 'fresh' ELSE 'stale' END AS dataset_state,
  COALESCE(cr.status::text, 'IDLE') AS run_status, COALESCE(cr.stage, 'catalog') AS stage,
  COALESCE(cr.matches_discovered, 0) AS matches_discovered, COALESCE(cr.matches_ingested, 0) AS matches_ingested,
  COALESCE(cr.observations_accepted, 0) AS observations_accepted, COALESCE(cr.observations_rejected, 0) AS observations_rejected,
  COALESCE(rs.top_sample, 0) AS top_sample, COALESCE(rs.jungle_sample, 0) AS jungle_sample,
  COALESCE(rs.middle_sample, 0) AS middle_sample, COALESCE(rs.bottom_sample, 0) AS bottom_sample,
  COALESCE(rs.utility_sample, 0) AS utility_sample,
  COALESCE((SELECT count(*) FROM participant_rejections pr WHERE pr.patch_id = p.id AND pr.reason = 'unknown_item'), 0)::integer AS unknown_item_count
FROM current_patch p
LEFT JOIN active_pub ap ON true
LEFT JOIN latest_run cr ON true
LEFT JOIN role_samples rs ON rs.publication_id = ap.id;

COMMENT ON VIEW public_status IS 'Public current-patch progress and publication status; excludes private identifiers and error details.';
