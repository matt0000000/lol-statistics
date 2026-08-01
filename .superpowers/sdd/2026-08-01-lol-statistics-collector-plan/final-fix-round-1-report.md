# Collector final-review fix round 1

## Changes

- Made Data Dragon patch rollover transactional: same-patch catalog refresh preserves the active publication; a new patch deactivates the old publication, activates the new patch with no publication pointer or publication timestamp, and retains historical rows.
- Added `patches.active_publication_id`; publication activation sets the pointer only after the global active-publication lock and run completion succeed.
- Added durable discovered-match `PENDING`/`UNAVAILABLE` state with a constrained `not_found` reason. Typed Riot 404s are checkpointed atomically, counted as ingested work, skipped on resume, and never refetched; other failures still abort the MATCHES stage.
- Added current-patch-aware public health derivation with explicit `dataset_warming`, current run status/stage/error, and null data age while warming.
- Reconciled Drizzle metadata: checked-in `0007_snapshot.json` now matches the existing one-publication-per-run migration; `0008_ambitious_hitman.sql`/snapshot add unavailable checkpoints and the patch publication pointer. Schema contracts cover every migration and durability invariant.
- Added pure, unit, and PostgreSQL-gated rollover, warming, unavailable-checkpoint, and health assertions.

## Verification

- `bun run test` — 184 passed, 59 PostgreSQL-gated skipped.
- `bun run typecheck` — all workspaces passed.
- `bunx drizzle-kit check` — passed.
- `bun run db:generate` — no schema changes; repeated invocation also produced no scratch migration.
- `git diff --check` — passed.
- `TEST_DATABASE_URL=... bunx vitest run ...` — attempted; PostgreSQL is unavailable in this environment (`TEST_DATABASE_URL` unset / local port not configured).

## Residual concerns

Runtime PostgreSQL transaction and migration assertions remain gated until a disposable PostgreSQL instance is available. The active publication pointer is maintained transactionally (without a direct schema FK to avoid the patches/publications creation cycle).
