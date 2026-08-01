# Task 6 Report: Aggregate Rebuild, Invariants, and Atomic Publication

## RED/GREEN evidence

- RED: `bunx vitest run apps/collector/src/services/rebuild-aggregates.test.ts` initially failed during suite loading with `Cannot find module './rebuild-aggregates'`.
- GREEN: after implementing the service, the same command passed (2 tests).
- RED: `bunx vitest run apps/collector/src/services/publish.test.ts` initially failed with `Cannot find module './publish'`.
- GREEN: after implementing verification/publication, the same command passed (2 tests).

## Implementation

- Added `rebuildAggregates` with deterministic champion/role grouping, baseline counters, one-per-observation item presence, quantity-preserving pair/trio multisets, boots counters, page sources, and sink flushing/replacement.
- Added `AggregatesRepository` with canonical valid-observation paging, aggregate upserts, exact publication replacement, aggregate reads, and publication/run activation helpers.
- Added `verifyPublication`, safe sorted invariant failure reports, recomputation comparison, and `publishAtomically` using a SERIALIZABLE transaction.
- Added the required pure-service and PostgreSQL-gated integration test files.

## Schema and migration

The baseline aggregate table is `baseline_aggregates` (`publication_id + champion_id + role` primary key), with nonnegative and `wins + losses = sample` checks.

- SQL migration: `migrations/0005_concerned_risque.sql`
- SQL SHA-256: `5680c5cedecdb557a3ba62cbf5ff85b91332caf5fdcfec90af590a3258902895`
- Snapshot: `migrations/meta/0005_snapshot.json`
- Snapshot SHA-256: `21a0dad03e132fc6f23a48bdaddf45f8ce66bf5cfc3b34ea62081475cb88ce57`

## Paging, grouping, and activation semantics

Canonical source pages join observations to matches and require `validationState = VALID`, patch equality, platform `TR1`, and queue `420`. Rows are ordered by champion, role, match, and participant identity. Rebuilds flush a completed champion-role group to the sink; repository replacement deletes stale rows and writes the exact snapshot transactionally. Publication verification checks count equations, baseline bounds/existence, catalog category/unknown IDs, invalid observation metadata, duplicate identity, and exact recomputation. Activation re-verifies inside a SERIALIZABLE transaction, deactivates the current publication, activates the target, marks the run published/completed, and timestamps the patch.

## Verification commands and results

- `bunx vitest run apps/collector/src/services/rebuild-aggregates.test.ts` — PASS (2 tests).
- `bunx vitest run apps/collector/src/services/publish.test.ts` — PASS (2 tests).
- `bunx vitest run` — PASS (159 tests), 6 PostgreSQL-gated suites skipped.
- `bun run typecheck` — PASS for all workspaces.
- `bunx drizzle-kit check` — PASS (`Everything's fine`).
- `bun run db:generate` — PASS; `No schema changes, nothing to migrate`.
- `git diff --check` — PASS.

PostgreSQL attempt (server unavailable):

```text
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/observations.integration.test.ts
...
Error: connect ECONNREFUSED 127.0.0.1:5432
Test Files 1 failed (1)
Tests 14 failed (14)
EXIT_STATUS=1
```

The new integration files are environment-gated; no real PostgreSQL aggregate/activation transaction was claimed as executed.

## Commit and residual limitations

Product implementation commit: `1123a05145faded6739032758aa4b68b248f6871` (`feat: publish verified item statistics atomically`).

The local environment has no PostgreSQL server, so database constraints, concurrent publication races, rollback, and query plans remain unexecuted here. Async iterable callers must provide the documented deterministic ordering; page-function sources are sorted per page. The repository replacement path is transactional, while a custom sink remains responsible for its own staging/atomicity.
