# Collector final-review fix round 3

## Changes

- Canonical publication verification and activation now acquire row locks in the shared order `collection_run → target aggregate_publication → global active aggregate_publication(s) → patch`. Run ownership is validated before a target row is trusted; missing and invalid identifiers produce deterministic errors.
- `ensurePublicationTarget` now follows the same run/target/global-active/patch order, preserving one target per run under overlap. Aggregate prepare/flush paths use the compatible run→target subset without locking unrelated active publications or patches.
- Added a pure mocked query-order regression test and a PostgreSQL-gated existing-target ensure-vs-publish barrier test. The barrier holds the target row, overlaps both callers at the lock wait, releases in `finally`, and asserts one target plus one activation.

## Verification

- `bun run test` — 194 passed, 60 PostgreSQL-gated skipped.
- `bun run typecheck` — all workspaces passed.
- `bunx drizzle-kit check` — passed.
- `bun run db:generate` twice — both reported no schema changes.
- `git diff --check` — passed.
- Focused PostgreSQL integration attempt — `TEST_DATABASE_URL` is not configured; 28 tests skipped.

## Residual concerns

The runtime PostgreSQL lock barrier and existing publication/flush race coverage remain gated until a PostgreSQL test URL is available.
