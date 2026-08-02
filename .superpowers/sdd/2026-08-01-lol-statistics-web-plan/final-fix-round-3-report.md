# Web Task 1 fix round 3

## Changes

- Made adjusted-score sorting explicitly null-safe: recommended rows precede low-confidence rows, and null/null comparisons continue through sample and canonical-key tie-breakers without `Infinity - Infinity`/`NaN` results.
- Added one exported canonical key comparator using deterministic code-point/ASCII ordering, matching the SQL `COLLATE "C"` cap ordering for all public statistic sorts. Added adversarial key and shuffled-low-confidence regressions.
- Exported the domain Wilson critical value and reused it in typed `double precision` SQL arithmetic, with reference vectors and generated-SQL assertions guarding numeric parity.
- Added a fake-executor >100-row parity regression covering adjusted, win-rate, build-rate, and sample ordering, including recommended/low-confidence rows and key-boundary ties.

## Verification

- `bun run test` — 226 passed, 67 skipped.
- `bunx vitest run packages/public-api/src packages/domain/src` — 51 passed, 7 skipped.
- `bun run typecheck` — all workspace packages passed.
- `bunx drizzle-kit check` — passed.
- `bun run db:generate` twice — both reported no schema changes; no generated diff.
- `git diff --check` — passed.
- `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/public-api/src/queries.integration.test.ts` — attempted and failed visibly with `ECONNREFUSED 127.0.0.1:5432`; no PostgreSQL server is available.

## Residual risk

The PostgreSQL integration fixture remains unexecuted in this environment. Pure/fake regressions verify SQL-shaped ordering and JS cap parity; runtime collation and PostgreSQL floating-point behavior still require a reachable test database.
