# Collector final-review fix round 2

## Changes

- Patch rollover now clears `active_publication_id` and `published_at` on every deactivated patch, while same-patch catalog refresh leaves both values unchanged. Added pure and PostgreSQL-gated assertions for old and new patch rows.
- Migration `0008_ambitious_hitman.sql` backfills the globally active publication pointer deterministically (`created_at`, then `id`) only when its patch is still active, and clears stale/inconsistent pointers. Nullable-column and metadata ordering are covered by schema contracts.
- Health selects collection runs only for the current active patch. With no current-patch run, the pure snapshot is safe warming/IDLE with zero counters, null data age, and no stale error.
- Match checkpointing now requires a genuine `RiotHttpError` with both `status === 404` and `category === 'not_found'`; mismatched status/category failures are propagated.
- Catalog rollover and publication verification/activation use a consistent target/global-publication-before-patch lock order to avoid inversion, including invalid already-active publication paths.

## Verification

- `bun run test` — 193 passed, 59 PostgreSQL-gated skipped.
- `bun run typecheck` — all workspaces passed.
- `bunx drizzle-kit check` — passed.
- `bun run db:generate` twice — both reported no schema changes.
- `git diff --check` — passed.
- Collector health JSON command — parsed successfully (`database_unavailable` expected without `DATABASE_URL`).
- Configured PostgreSQL integration attempt — `TEST_DATABASE_URL` is not configured; gated integration tests skipped.

## Residual concerns

Runtime PostgreSQL rollover, migration backfill, and lock-concurrency assertions remain gated until a PostgreSQL test URL is available.
