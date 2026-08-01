# Task 4 report — match eligibility and participant observation parsing

## RED/GREEN evidence

- RED: before implementation, the requested eligibility and ingestion test files did not exist (`vitest`: no test files found).
- GREEN: after implementation, focused domain/collector tests pass (11 tests), and the database repository suite passes its non-integration tests (12 passed, 10 skipped without a database).
- The new PostgreSQL integration suite contains six isolated, `TEST_DATABASE_URL`-gated cases covering accepted/rejected persistence, replay idempotency, differing replay failure/rollback, FK/patch/run/discovery rejection, concurrent saves, and rejected-only/remake counters.

## Files

- `packages/domain/src/{tiers,eligibility}.ts` and eligibility tests
- `apps/collector/src/services/ingest-match.ts` and unit tests
- `packages/database/src/repositories/observations.ts` and `observations.integration.test.ts`
- package exports and collector workspace dependency updates

## Verification

- `bunx vitest run packages/domain/src/eligibility.test.ts apps/collector/src/services/ingest-match.test.ts packages/database/src/repositories --passWithNoTests` — 12 passed, 10 skipped (integration gated).
- `bun --filter @lol/domain typecheck && bun --filter @lol/database typecheck && bun --filter @lol/collector typecheck` — passed.
- `bun run db:generate -- --name verify_task4` — no schema changes generated.
- `git diff --check` — clean.
- `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/observations.integration.test.ts` — attempted as required; all six tests fail visibly with `connect ECONNREFUSED 127.0.0.1:5432` because PostgreSQL is unavailable in this environment.

## Commits

- `9115905` — implementation and unit tests
- pending follow-up commit — integration suite, report, and strict discovered-work guard

No production database schema migration was needed.
