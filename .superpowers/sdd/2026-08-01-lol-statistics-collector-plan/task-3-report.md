# Task 3 report: ladder snapshot and match discovery checkpoints

## Implementation summary

- Added `ladder_snapshots.next_match_offset` (nonnegative, default `0`) and the run-scoped `discovered_matches` work table keyed by `(run_id, match_id)`.
- Added migration `migrations/0002_next_jack_murdock.sql` and Drizzle metadata snapshot.
- Added transactional, idempotent `LadderRepository` snapshots (queue `420`, Emerald+ tiers, divisions I–IV) that preserve a greater discovery offset.
- Added transactional `MatchesRepository.savePage` with `onConflictDoNothing`, monotonic `greatest` offset updates, and exact unique-run `matchesDiscovered` counters.
- Added resumable `CollectionRunRepository`, `snapshotLadder`, `discoverMatches`, an in-memory discovery repository for unit tests, and PostgreSQL-gated integration coverage.

## RED evidence

The prescribed first test was `bunx vitest run apps/collector/src/services/discover-matches.test.ts`; at the start of Task 3 the service and test files did not exist, so the expected RED condition was the missing service/module. The test was then implemented and now passes (2 tests). No pre-implementation output was retained in the worktree.

## Verification

- `bunx vitest run apps/collector/src/services/discover-matches.test.ts packages/database/src/schema.contract.test.ts` — 2 files, 8 tests passed.
- `bunx vitest run` — 12 files passed, 3 PostgreSQL/integration files skipped; 110 tests passed, 7 skipped.
- `bunx tsc --noEmit -p packages/database/tsconfig.json` — passed.
- `bunx tsc --noEmit -p apps/collector/tsconfig.json` — passed.
- `bun run db:generate` — generated `migrations/0002_next_jack_murdock.sql` consistently.
- `git diff --check` — passed; final worktree is clean after this report commit.

PostgreSQL is unavailable locally. With `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats`, the integration command fails during setup with `Error: connect ECONNREFUSED 127.0.0.1:5432`; without that variable, the integration suite is structurally runnable and skipped by `describe.skipIf`.

## Native Bun runner discrepancy

`bun test` exits 1 with 109 passed, 11 skipped, and one failure in the pre-existing `RiotHttpClient > redacts path identifiers and response details from errors` test. Bun's matcher callback receives `undefined` for the rejected error (`TypeError: undefined is not an object (evaluating 'error.message.includes')`), despite the same test passing under the repository's configured Vitest runner. `vitest.config.ts` explicitly configures Vitest projects and the authoritative command is therefore `bunx vitest run`; no Task 3 production code was changed for this runner-only discrepancy.

## Migration and commits

- Migration: `0002_next_jack_murdock.sql`
- Migration SHA-256: `ac76a69694a3abb565a5c2e2322e489a9e7360caa419d5482f1f70786ec7ede4`
- Implementation commit: `b45300e0bd0f222e476a4cabffe8c3fb80b0fbdc` (`feat: checkpoint ladder and match discovery`)

## Fix Round 1

- Serialized `savePage` transactions by locking and validating the eligible `collection_runs` row before inserts/counts; missing, terminal, and failed runs now reject without partial work.
- Made stage/status transitions transactional and row-locked, enforced monotonic stage/status rules, terminal timestamps, resume cleanup, and allowlisted error details/counters.
- Required existing eligible ladder snapshots for offsets, rejected unknown/terminal runs, required canonical `RANKED_SOLO_5x5`, and added queue/division database checks.
- Redacted dependency/repository failures in both collector services to static errors and expanded concurrent, privacy, and per-test isolated integration coverage.

Fix verification:

- `bunx vitest run` — 13 files passed, 3 PostgreSQL/integration files skipped; 112 tests passed, 8 skipped.
- `bunx vitest run apps/collector/src/services packages/database/src/schema.contract.test.ts packages/database/src/repositories/discovery.integration.test.ts` — 3 files passed, 1 skipped; 10 passed, 2 skipped.
- `bunx tsc --noEmit -p packages/database/tsconfig.json` and `bunx tsc --noEmit -p apps/collector/tsconfig.json` — passed.
- `bun run db:generate` — no schema changes after `migrations/0003_faulty_redwing.sql`.
- `git diff --check 79b3b8120853654c9c80655cf00664a12a9badbe..HEAD` and working-tree `git diff --check` — clean after removing EOF blank-line warnings.

Fix migration: `0003_faulty_redwing.sql`, SHA-256 `0e7ced8b6bb47796f789fbb83519cbeb1b38f2d9b8a4caa05d26eac2b749af2a`.
