# Final fix B — coverage recovery round 2

Base: `ccef816`

## Implemented

- Replaced the `ALTER TYPE ... ADD VALUE` migration with an atomic enum recreation.
- The migration drops the reason-state check and status default before creating and swapping in a new `discovered_match_status` enum, then restores the `PENDING` default and exact state/reason check.
- Added a schema contract regression asserting no `ADD VALUE` remains and enforcing dependency statement ordering.
- Added a PostgreSQL-gated upgrade test that reconstructs a pre-0012 database state, preserves PENDING/UNAVAILABLE rows, verifies enum labels/default/check metadata, and exercises a PROCESSED transition.

## Verification

- Focused contract/upgrade tests: 11 passed, 1 skipped (PG-gated; `TEST_DATABASE_URL` unavailable).
- `bun run test`: 374 passed, 74 skipped (PG-gated).
- `bun run typecheck`: passed for all workspaces.
- `bun run db:generate` (twice): no schema changes, nothing to migrate.
- `bunx drizzle-kit check`: passed.
- `bun run build`: passed.
- `git diff --check`: passed.

PostgreSQL-backed upgrade assertions were skipped because `TEST_DATABASE_URL` is not configured in this environment.
