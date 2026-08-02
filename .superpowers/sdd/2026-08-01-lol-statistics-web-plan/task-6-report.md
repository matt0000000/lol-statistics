# Task 6 report

## Delivered

- Added Playwright configuration and root `test:e2e`, `seed:e2e`, and `build` scripts.
- Added browser coverage for champion search, explicit roles, unavailable roles,
  all views and sorts, low-confidence opt-in, 404, keyboard reachability, stale/
  warming state contracts, and 390px overflow.
- Added a deterministic Jinx/Ahri publication seed. It validates `NODE_ENV=test`
  and a database name ending in `_test` before opening a PostgreSQL connection.
- Added static client/security-boundary checks and production web operations
  requirements.

## Verification

- `bun run test` — PASS (311 passed, 71 existing integration tests skipped).
- `bun run typecheck` — PASS for every workspace package.
- `bun run build` — PASS (`@lol/web` production build).
- `bunx vitest run apps/web/tests/security-boundary.test.ts` — PASS (2 tests).
- Seed refusal checks for wrong `NODE_ENV` and non-`_test` database — PASS;
  both exited before connection. A valid `_test` URL reached PostgreSQL and
  failed with `ECONNREFUSED` because PostgreSQL is unavailable on this host.
- `bunx playwright test e2e/champion-statistics.spec.ts` — authored suite
  started but all 7 tests were blocked by the project browser failing to load
  `libnspr4.so`; no tests were skipped.

## Runtime limitations

Docker/PostgreSQL is unavailable (Docker Desktop WSL integration is disabled),
and the Playwright Chromium binary cannot start because required host library
`libnspr4.so` is missing. E2E and database seed gates therefore remain to be
run in CI or a provisioned Linux/PostgreSQL environment.

