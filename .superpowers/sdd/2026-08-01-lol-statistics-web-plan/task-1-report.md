# Task 1 report: public contracts, views, and query repository

Implemented the read-only public API foundation for the active TR1 Ranked Solo Emerald+ publication.

## Files

- `packages/public-api/{package.json,tsconfig.json}`
- `packages/public-api/src/{contracts,sort,sort.test,contracts.test,queries,queries.integration.test,index}.ts`
- `apps/web/lib/{web-config,web-config.test}.ts`
- `apps/web/package.json`
- `migrations/0009_public_views.sql`
- `migrations/meta/{0009_snapshot.json,_journal.json}`
- `vitest.config.ts`, `bun.lock`

## Implementation

- Strict Zod contracts reject unknown/private fields and non-finite or inconsistent numeric values.
- Stable statistic sorting places recommended rows first, then sample and canonical key tie-breakers.
- `createPublicQueries` uses allowlisted view names, parameterized inputs, bounded champion search (50), output cap (100), low-confidence filtering, and Wilson-derived metrics.
- Every public statement resolves `public_active_publication`; the view requires the globally active publication, the active patch, and `patches.active_publication_id` to agree. Missing rollover pointers therefore produce `dataset_warming` rather than historical data.
- Migration `0009` creates security-barrier views for active publication metadata, champions, item catalog, baselines, items, canonical pairs/trios, and boots. Private PUUIDs, match IDs, raw slots, run errors, and API credentials are not selected.
- Web configuration accepts the read-only database URL and public site URL, rejects writer/Riot credentials without echoing secrets, and tolerates unrelated process environment keys.

## Verification

- `bun run test` — 28 files passed, 8 skipped; 201 tests passed, 62 skipped.
- Focused contracts/sort/config tests — 7 passed.
- `bun run typecheck` — all workspace packages passed.
- `bunx drizzle-kit check` — passed.
- `bun run db:generate` twice — both reported no schema changes; no generated diff.
- `git diff --check` — passed.
- `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/public-api/src/queries.integration.test.ts` — failed visibly with `ECONNREFUSED 127.0.0.1:5432` (configured database unavailable).

## Remaining limitation

PostgreSQL integration views/query tests could not execute because no local PostgreSQL server is available in this environment; the integration suite is skipped only when `TEST_DATABASE_URL` is absent and fails visibly when configured but unreachable.
