# Web Task 1 fix round 2

## Changes

- Added a pure fake-executor query-boundary regression covering strict stats responses, all published champion roles, and distinct warming/champion/role error states.
- Added exact bounded SQL ordering for adjusted (Wilson lower bound), raw win rate, build rate, and sample sorts, including sample and canonical-key tie-breaks. Adjusted SQL uses the same numeric-safe Wilson expression as the domain implementation and low-confidence rows sort after recommended rows.
- Added deterministic `C` collation for canonical numeric item keys and projected `selected_champion.roles` through the outer stats query.
- Added pure and PostgreSQL-gated >100-candidate regressions proving a lower-sample high-Wilson candidate remains in the adjusted top 100.

## Verification

- `bun run test` — 219 passed, 67 skipped.
- `bunx vitest run packages/public-api/src` — 10 passed, 7 PostgreSQL-gated skipped.
- `bun run typecheck` — all workspace packages passed.
- `bun run db:generate` twice — both reported no schema changes; no generated diff.
- `git diff --check` — passed.
- `bunx vitest run packages/public-api/src/queries.integration.test.ts` — 7 PostgreSQL-gated tests skipped because `TEST_DATABASE_URL` is unset; configured PostgreSQL execution remains unavailable in this environment.

## Residual risk

The PostgreSQL-only fixture and SQL collation/runtime assertions require a reachable `TEST_DATABASE_URL`; the fake and pure regressions execute without PostgreSQL.
