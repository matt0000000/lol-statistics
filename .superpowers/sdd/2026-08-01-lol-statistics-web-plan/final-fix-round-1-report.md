# Web Task 1 fix round 1

## Changes

- Restricted `DATABASE_READ_URL` to `postgres:`/`postgresql:` URLs and `PUBLIC_SITE_URL` to credential-free `http:`/`https:` URLs. Validation errors remain generic and never include URL values; public root/trailing paths are normalized consistently.
- Added strict Zod parsing at every public query boundary, including metadata, champions, champion details, statistics, methodology, and typed error responses.
- Champion details now require at least one published aggregate role, and statistics responses expose every available role for the champion while preserving the requested role baseline.
- Bounded aggregate SQL reads to deterministic 100-row result sets after confidence filtering. Search remains SQL-limited to 50 rows and all view names remain allowlisted.
- Expanded the isolated migrated PostgreSQL fixture to cover stale/current publications, two champions and multiple roles, core/boots catalog IDs, recommended and low-confidence aggregate rows, all statistic views/sorts, confidence filtering, role/champion errors, strict contracts, and forbidden-column view-definition checks.

## Verification

- `bunx vitest run apps/web/lib/web-config.test.ts` — 15 passed.
- `bunx vitest run packages/public-api/src` — 5 passed, 2 PostgreSQL-gated skipped.
- `bun run test` — 214 passed, 66 skipped.
- `bun run typecheck` — all workspace packages passed.
- `git diff --check` — passed.
- PostgreSQL integration was attempted through the configured-gated suite; no local PostgreSQL server was available, so the disposable migrated fixture remains unexecuted in this environment.

## Residual risk

Runtime PostgreSQL view, migration, and fixture assertions require a reachable `TEST_DATABASE_URL`; the suite intentionally skips only when it is absent and fails visibly when configured but unavailable.
