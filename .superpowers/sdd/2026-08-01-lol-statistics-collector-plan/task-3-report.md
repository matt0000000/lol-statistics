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

