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

The initial implementation needed no schema migration; Fix Round 1 adds the required rejection-audit invariant migration below.

## Fix Round 1

- Added migration `0004_participant_rejections.sql` (and Drizzle snapshot/journal updates) with a constrained `rejection_reason` enum and composite `(match_id, patch_id)` foreign key.
- Rejected participants are now canonical rows; replay equality covers accepted/rejected partition, rejection reason, PUUID, match validation state/error, normalized core rows, and boots.
- Rejected-only matches persist as `REJECTED` with static `NO_ELIGIBLE_PARTICIPANTS`; accepted matches remain `VALID`. Active patch is required by ingestion and the repository enforces `patches.is_active = true`.
- Fix-round focused/full relevant suite: 30 passed, 17 skipped (integration gated); all package typechecks passed; `db:generate` reports no pending schema changes; `git diff --check` clean.
- PostgreSQL attempt with `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats` ran all 7 integration cases and failed visibly with `connect ECONNREFUSED 127.0.0.1:5432`.

## Fix Round 2

- Corrected integration coverage for inactive patch IDs versus active patch/game-version mismatch, and added strict empty-participant rejection with no match/counter mutation.
- Added isolated replay-variant cases for PUUID, inventory/core/boots/raw slots, match duration, and rejection reason changes; all assert canonical rows remain unchanged while the run is durably failed.
- Tightened `toPatchKey` to major/minor plus numeric suffix components only, and tightened Riot match DTO participant arrays to non-empty.
- Fresh verification: `bunx vitest run packages/domain/src apps/collector/src/services packages/riot-client/src packages/database/src/repositories packages/database/src/schema.contract.test.ts --passWithNoTests` — 85 passed, 22 skipped; all workspace typechecks passed; `db:generate` reports no changes; `git diff --check` clean.
- PostgreSQL attempt ran all 12 integration tests and failed visibly with `connect ECONNREFUSED 127.0.0.1:5432` (database unavailable).

## Fix Round 3

- Added a static `IngestMatchError("empty_participants")` service-boundary guard; runtime-cast empty payloads now fail before remake parsing or repository calls, with no payload values in the error.
- Split inventory replay coverage into independent fresh-DB raw-slot, normalized core quantity/slot, and boots-only variants; complete canonical row and run-counter snapshots are compared after each durable replay conflict.
- Expanded inactive/mismatched patch rejection assertions across matches, observations, rejections, core/boots, discovery work, and all run counters.
- `toPatchKey` now rejects unsafe numeric components/overflow while canonicalizing safe leading-zero components; official multi-component versions remain accepted.
- Fresh focused verification: 16 passed, 14 skipped (integration gated); all workspace typechecks passed; db:generate reports no changes; diff check clean.
- Final PostgreSQL attempt ran all 14 isolated integration cases and failed visibly with `connect ECONNREFUSED 127.0.0.1:5432`.
