# Task 6 fix round 1 report

## Fixes

- Playwright now owns an isolated configurable port (default `4173`), never reuses an arbitrary server, starts `@lol/web` directly, and passes the read-only database/public-site environment through.
- E2E fixtures are database-backed and explicitly seeded in `fresh`, `stale`, and `warming` modes before each flow. The specs assert exact stale/warming copy, fresh-banner absence, and publication-boundary behavior.
- Browser coverage now uses real `Tab` navigation with an ordered focus contract and validates active sort semantics plus descending row values for every supported sort. Existing search, role, view, low-confidence, 404, mobile overflow, and disclosure flows remain covered.
- The security boundary resolves relative imports with extension substitution and index variants, workspace package aliases, and dynamic/static edges from every client root. It scans transitive client sources and API fixture JSON for collector secrets, private identifiers, raw slots/items, and private detail fields, with isolated regression fixtures.
- `seedE2E` and its CLI both validate `NODE_ENV=test`, PostgreSQL URL syntax, and a decoded database name ending in `_test` before opening a connection. Direct helper tests cover encoded names, query strings, and bypass attempts.

## Verification

- `bun run test` — PASS (316 passed, 71 skipped).
- `bun run typecheck` — PASS for all workspace packages.
- `bun run db:generate` — PASS; no schema changes.
- `bun run build` — PASS (`@lol/web`).
- `git diff --check` — PASS.
- Focused security/seed/config Vitest — PASS (7 tests).
- `NODE_ENV=test TEST_DATABASE_URL=postgres://lol:lol@127.0.0.1:5432/lol_stats_test DATABASE_READ_URL=postgres://lol:lol@127.0.0.1:5432/lol_stats_test bun run test:e2e` — attempted; tests discovered and run, but DB-backed seeds fail with `ECONNREFUSED 127.0.0.1:5432`. The later browser launch independently fails because host library `libnspr4.so` is unavailable. No tests were skipped.

## Residual risks

- Full browser assertions and SQL seed correctness still require CI/provisioned PostgreSQL plus the missing Chromium host library. The E2E suite intentionally fails loudly in either absence case.
