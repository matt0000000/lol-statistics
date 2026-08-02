# Final fix B — coverage recovery round 1

Base: `76a4309`

## Implemented

- Upgraded `0011_coverage_recovery` without migration-time defaults: legacy rows are backfilled from `started_at - coverage_days * interval '1 day'`, then a safe new-row default is installed and the column is made `NOT NULL`.
- Added `PROCESSED` discovery status and recreated the reason/state check so only `UNAVAILABLE` has a reason, while `PENDING` and `PROCESSED` require a null reason. Drizzle schema and `0012_snapshot.json` match.
- Made `MatchesRepository.markProcessed` transactional, run-eligible, idempotent for `PENDING`/`PROCESSED`, and a no-op for terminal `UNAVAILABLE` rows.
- Canonical `VALID` matches in collection now checkpoint the current run as `PROCESSED` before continuing. Same-run checkpoints remain pending-free while rejected canonical matches can be retried by later runs.

## Verification

- `bun run test`: 374 passed, 73 skipped (PG-gated)
- `bun run typecheck`: passed for all workspaces
- `bun run db:generate`: no schema changes, nothing to migrate
- `bunx drizzle-kit check`: passed
- `bun run build`: passed
- `git diff --check`: passed
- Focused migration/discovery tests: 24 passed, 13 skipped (PG-gated)

PostgreSQL integration assertions were skipped because `TEST_DATABASE_URL` is not configured in this environment.
