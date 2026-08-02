# Public web operations

The web process is a read-only consumer of the active publication. Configure
these server-only settings in the deployment secret store:

- `DATABASE_READ_URL`: PostgreSQL URL for the dedicated reader role.
- `PUBLIC_SITE_URL`: canonical HTTPS origin used for metadata, links, and health checks.

`PUBLIC_SITE_URL` must use HTTPS in production. Never expose `DATABASE_READ_URL`
to the browser, and never configure `RIOT_API_KEY` in the web process. A
development or personal Riot key cannot operate a public release; collection is
performed by the separately scheduled collector described in
[`collector.md`](./collector.md).

## Database permissions

Run migrations and publication activation before deploying the web revision.
Create a separate login role and grant it only `USAGE` on schema `public` and
`SELECT` on these security-barrier views:

```sql
GRANT USAGE ON SCHEMA public TO lol_web_reader;
GRANT SELECT ON public_active_publication, public_champions,
  public_item_metadata, public_champion_role_baselines, public_item_stats,
  public_combination_stats, public_boots_stats, public_status TO lol_web_reader;
```

Do not grant the reader role access to canonical tables, raw observations,
ladder snapshots, PUUIDs, match records, collector checkpoints, or error-detail
columns. Verify the grants from a fresh reader connection during a release.

## Cache and freshness

Responses are scoped to the immutable active publication and may be cached at
the edge. Keep ETags and cache keys tied to the publication ID; invalidate or
revalidate metadata when the active pointer changes. The active pointer is
advanced atomically only after migrations, aggregate invariants, and catalog
checks pass. Partial collector runs are never public.

The UI distinguishes these states:

- **Warming**: no valid current-patch publication exists. API statistics return
  `503` with `dataset_warming` and retry metadata.
- **Fresh**: publication time is no more than six hours old.
- **Stale**: an older publication remains available after six hours. Keep it
  visible with a stale warning; do not relabel it as the current patch.

## Deployment and health checks

Deploy in this order: apply checked-in migrations, verify the views and grants,
run the collector on its independent schedule, then roll out the web revision.
Do not run collection inside the web process. A release is healthy only when
`GET /api/meta`, `GET /api/champions`, and `GET /status`
return successfully from the reader role and the response body contains no
private identifiers. Check the status page for patch, publication age, run
stage, and public-safe counters. Alert on `dataset_warming`, stale data, a
failed publication, or database connection errors.

The collector must remain separately scheduled (hourly by default) with its
production Riot credential, rate-limit handling, and PostgreSQL advisory lock.
The web deployment must not contain a Riot key or any alternate development
data path.

## E2E and test database safety

Seeding is restricted to an explicitly supplied `TEST_DATABASE_URL`. Its
PostgreSQL database name must end in `_test`; `DATABASE_READ_URL` and
`DATABASE_URL` are never used as seed fallbacks. `bun run test:e2e` passes that
same validated URL to the web process as `DATABASE_READ_URL`, so the browser
cannot read a different database than the one seeded. The command refuses
before starting Next or opening a database connection when the variable is
missing or unsafe.
