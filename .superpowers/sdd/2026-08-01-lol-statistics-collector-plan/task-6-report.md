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

## Fix round 1 (review findings)

- Production `verifyPublication`/`publishAtomically` now accept only publication/run IDs, a database transaction, and the canonical repository. Caller-supplied snapshots are rejected at runtime; `verifyPublicationSnapshot` is explicitly test/diagnostic-only.
- `lockAndLoad` locks target publication, run, patch, active publication rows, aggregate rows, catalog rows, and source observation/match rows in one SERIALIZABLE verification transaction. Activation conditionally switches the locked target, run, and patch with returning-row checks.
- Run lifecycle is explicit: target publication must be inactive, owned by the run/patch, and the run must be `RUNNING` at `publish`; activation atomically sets `COMPLETED` and `publicationId`.
- Canonical verification now requires catalog metadata, validates normalized/raw categories, strict canonical combination keys, complete match metadata, duplicate identities, empty-snapshot recomputation, and deterministic sorted failure codes.
- Rebuild now validates global monotonic ordering for async/page sources, rejects group reappearance, flushes one group at a time, uses raw catalog keys before normalization, and supports `preparePublication` streaming sinks that clear only inactive owned targets.
- Integration files now use `createMigratedTestDatabase` and contain real isolated replacement and activation cases (execution remains PostgreSQL-gated).

Fix-round verification:

- `bunx vitest run apps/collector/src/services/rebuild-aggregates.test.ts apps/collector/src/services/publish.test.ts` — PASS (8 tests).
- `bunx vitest run` — PASS (162 tests), 6 PostgreSQL-gated suites skipped.
- `bun run typecheck` — PASS for all workspaces.
- `bunx drizzle-kit check` — PASS.
- `bun run db:generate` — PASS; no schema changes.
- `git diff --check` — PASS.

Actual new integration attempt:

```text
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/aggregates.integration.test.ts apps/collector/src/services/publish.integration.test.ts
Error: connect ECONNREFUSED 127.0.0.1:5432
Test Files 2 failed (2)
Tests 2 failed (2)
EXIT_STATUS=1
```

Fix-round code/tests commit: `57f5b03c16ec74d2af1aa85afe23660166ce052a` (`fix: enforce canonical aggregate publication invariants`).

## Fix round 2 (trust boundary/catalog)

- Removed aggregate activation internals from the `@lol/database` package export surface. Production publication now accepts only IDs plus a branded `Database` returned by `createDatabase`; fake structural databases and caller snapshots are rejected before any transaction.
- Canonical SQL locking/loading and activation are module-private to the collector publication service. Activation conditionally updates exactly one target, run, and patch row and has no tautological success path.
- Empty catalogs now fail with `CATALOG_MISSING`; production integration fixtures seed official-like CORE and BOOTS rows. Test-database helpers expose the isolated URL so production tests can create a branded connection.
- Added pure empty-catalog/trust-boundary coverage and retained isolated aggregate/publication integration cases.

Fix-round-2 verification:

- `bunx vitest run apps/collector/src/services/publish.test.ts apps/collector/src/services/rebuild-aggregates.test.ts` — PASS (9 tests).
- `bunx vitest run` — PASS (164 tests), 6 PostgreSQL-gated suites skipped.
- `bun run typecheck` — PASS for all workspaces.
- `bunx drizzle-kit check` — PASS.
- `bun run db:generate` — PASS; no schema changes.
- `git diff --check` — PASS.

Actual new integration suites with PostgreSQL URL:

```text
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/aggregates.integration.test.ts apps/collector/src/services/publish.integration.test.ts
Error: connect ECONNREFUSED 127.0.0.1:5432
Test Files 2 failed (2)
Tests 2 failed (2)
EXIT_STATUS=1
```

Fix-round-2 product commit: `685636e5da31ccef3592616639f4737ee30b1402` (`fix: harden canonical publication trust boundary`).

## Fix round 3 (owner-bound rebuild lifecycle)

- `AggregateOwner` is now mandatory (`publicationId`, `runId`, `patchId`) and every sink must implement `preparePublication(owner)` plus owner-bound `flushGroup`; arbitrary publication IDs are no longer accepted by flush/replace.
- `AggregatesRepository` binds its session to the exact owner only after a successful inactive/ownership check and clears stale rows during prepare. Flush and replacement require preparation and re-lock exact ownership/inactive state; activation is not present on the rebuild repository.
- Rebuild inputs require all three owner IDs and the pure tests use lifecycle-aware sinks. A target becoming active or an owner mismatch aborts writes.

Fix-round-3 verification:

- `bunx vitest run apps/collector/src/services/rebuild-aggregates.test.ts apps/collector/src/services/publish.test.ts` — PASS (10 tests).
- `bunx vitest run` — PASS (165 tests), 6 PostgreSQL-gated suites skipped.
- `bun run typecheck` — PASS for all workspaces.
- `bunx drizzle-kit check` — PASS.
- `bun run db:generate` — PASS; no schema changes.
- `git diff --check` — PASS.

Actual aggregate/publication integration attempt:

```text
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/aggregates.integration.test.ts apps/collector/src/services/publish.integration.test.ts
Error: connect ECONNREFUSED 127.0.0.1:5432
Test Files 2 failed (2)
Tests 2 failed (2)
EXIT_STATUS=1
```

Fix-round-3 product commit: `3d03ffd24fcca43cb4903be39146126172d12dd7` (`fix: bind aggregate rebuilds to owned publications`).

## Fix round 4 (lifecycle transactions and integration matrix)

- `AggregatesRepository.preparePublication(owner)` is now a single-use session operation. A second call always throws `aggregate sink already prepared` before touching rows, including when the owner is identical. A fresh repository can explicitly retry an inactive target after a failed process/session.
- `flushGroup(group)` now opens one transaction when no transaction is supplied. The inactive/owner `FOR UPDATE` check and every baseline/item/pair/trio/boots insert execute under that same lock/transaction. Replacement/bulk writes continue to reuse one caller transaction, so an activation or ownership race either serializes before inserts or rejects without partial rows.
- `rebuildAggregates` validates UUID publication/run IDs, positive safe patch IDs, and the complete prepare/flush sink lifecycle before invoking `preparePublication`; invalid `as any` inputs fail before any sink call.
- PostgreSQL integration coverage is now 23 isolated cases across `aggregates.integration.test.ts` (8) and `publish.integration.test.ts` (15). Cases cover pre-prepare rejection, owner/active checks, single-use prepare preservation, stale-table clearing, exact replacement/new-session retry, canonical source filtering/order, valid nonempty activation, prior-active switching/rollback, empty catalog, missing baseline, invalid source, wrong run/patch IDs, wrong stage/status, and already-active targets. Every case creates a fresh migrated database in setup; configured-unavailable PostgreSQL fails each setup visibly.

Fix-round-4 verification:

- `bunx vitest run apps/collector/src/services/rebuild-aggregates.test.ts apps/collector/src/services/publish.test.ts` — PASS (14 tests).
- `bunx vitest run` — PASS (169 tests), 6 PostgreSQL-gated suites skipped (53 gated tests).
- `bun run typecheck` — PASS for all workspaces.
- `bunx drizzle-kit check` — PASS (`Everything's fine`).
- `bun run db:generate` — PASS; no schema changes.
- `git diff --check` — PASS.

Actual new PostgreSQL integration attempt (server unavailable):

```text
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/aggregates.integration.test.ts apps/collector/src/services/publish.integration.test.ts
Error: connect ECONNREFUSED 127.0.0.1:5432
Test Files 2 failed (2)
Tests 23 failed (23)
EXIT_STATUS=1
```

The integration matrix is intentionally retained as setup-failing when `TEST_DATABASE_URL` points at an unavailable server; no PostgreSQL success is claimed locally.

## Fix round 5 (final review fixes)

- Corrected the PostgreSQL ownership matrix so independent failed `preparePublication` checks use fresh repository sessions. A dedicated case now asserts the intentional sticky single-use behavior: after any failed prepare attempt, the same session rejects every later prepare as `aggregate sink already prepared`, while a fresh session may retry an inactive target.
- Added deterministic PostgreSQL-gated concurrency coverage. An internal collector-module test hook pauses a verified activation while the target row lock is held; a real `AggregatesRepository.flushGroup` transaction overlaps and then serializes/rejects after activation. A second test starts two publication attempts concurrently and asserts the unique active-publication invariant after serialization. No sleeps are used.
- Added rollback coverage with a test-only internal hook that throws immediately after the transaction deactivates the prior publication. The transaction rollback assertions prove the prior active publication remains active, the target remains inactive, and the run remains `RUNNING`.
- Removed the unreachable `replacePublication` sink branch and API. Rebuilds now document and enforce owner-bound `preparePublication` plus streaming `flushGroup` semantics only.
- Exported `AggregatesRepository` for integration-test construction; no activation internals are exported. The failure-injection hook is an internal collector module helper and is not part of a public package export.

Fix-round-5 verification:

- `bunx vitest run apps/collector/src/services/rebuild-aggregates.test.ts apps/collector/src/services/publish.test.ts` — PASS (14 tests).
- `bunx vitest run` — PASS (169 tests), 6 PostgreSQL-gated suites skipped (57 gated tests).
- `bun run typecheck` — PASS for all workspaces.
- `bunx drizzle-kit check` — PASS (`Everything's fine`).
- `bun run db:generate` — PASS (`No schema changes, nothing to migrate`).
- `git diff --check` — PASS.
- `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/aggregates.integration.test.ts apps/collector/src/services/publish.integration.test.ts` — attempted; all 27 configured PostgreSQL cases failed setup with `ECONNREFUSED 127.0.0.1:5432` because no local server is available. No green PostgreSQL execution is claimed.

## Escalated PostgreSQL matrix remediation

- Every gated database setup now seeds official-like metadata for CORE items `3031`, `6672`, and `6692`, plus BOOTS `3006`. The empty-observations activation case retains that catalog, while the explicit empty-catalog case deletes it intentionally. This keeps all 27 configured cases executable against a real migrated PostgreSQL database.
- Removed the production `__setPublishTestHooks` export and hook types entirely. Synchronization and failure injection are confined to each integration test database through a temporary control table and trigger. The pause trigger waits on a PostgreSQL advisory lock; the rollback trigger raises only on target activation when its test control row is enabled.
- Added bounded `withTimeout`/`waitForLock` barriers. Flush-vs-activation now observes an activation advisory wait and a real `pg_stat_activity` row-lock waiter before releasing the advisory lock, then asserts activation success, exact flush rejection (`aggregate sink owner is no longer valid`), and no aggregate rows. Concurrent publication now proves overlap through the lock waiter, asserts winner/loser statuses and publication IDs, one active target, and patch publication metadata. Rollback snapshots publication flags, both run statuses/publication IDs, patch state, and every aggregate table and verifies complete restoration.

Remediation verification:

- `bunx vitest run apps/collector/src/services/publish.test.ts apps/collector/src/services/rebuild-aggregates.test.ts apps/collector/src/services/publish.integration.test.ts packages/database/src/repositories/aggregates.integration.test.ts` — PASS (14 unit tests; 27 PostgreSQL tests skipped without `TEST_DATABASE_URL`).
- `bun run typecheck` — PASS for all workspaces.
- `git diff --check` — PASS.
- `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/aggregates.integration.test.ts apps/collector/src/services/publish.integration.test.ts` — attempted; all 27 cases failed setup with `ECONNREFUSED 127.0.0.1:5432`. No PostgreSQL execution is claimed locally.

## Lock-observation remediation

- PostgreSQL waits are correlated to the exact test-controlled backend (`pid` and unique `application_name`). Advisory waits require `wait_event_type = 'Lock' AND wait_event = 'advisory'`; row-conflict waits require `wait_event_type = 'Lock' AND wait_event IN ('transactionid', 'tuple')`.
- Flush and concurrent publication operations use separate branded, single-connection databases. Polling is a finite awaited deadline with a database `statement_timeout`; no detached timeout race remains. Cleanup unlocks the barrier, awaits every operation promise, and closes every dedicated client in nested `finally` blocks.
- `createDatabase` accepts an optional pool size so these tests can enforce one backend per operation while retaining the existing default for production callers.

Lock-observation verification:

- Focused unit/integration-gated command without `TEST_DATABASE_URL`: PASS (14 unit tests; 27 PostgreSQL tests skipped).
- `bun run typecheck`, `bunx drizzle-kit check`, `bun run db:generate`, and `git diff --check`: PASS.
- `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/aggregates.integration.test.ts apps/collector/src/services/publish.integration.test.ts`: attempted; all 27 configured PostgreSQL tests failed setup with `ECONNREFUSED 127.0.0.1:5432`. No gated PostgreSQL execution is claimed locally.
