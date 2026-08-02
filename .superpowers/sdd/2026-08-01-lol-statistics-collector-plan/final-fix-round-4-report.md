# Collector final-review fix round 4

## Changes

- Corrected the ensure-vs-publish PostgreSQL lock barrier predicate: ensure remains asserted waiting on the held `aggregate_publications` target row, while publish is asserted waiting on the shared `collection_runs` row acquired first by its canonical lock order.
- Preserved backend PID plus `application_name` correlation, bounded lock polling, and `finally` cleanup. After releasing the held target, both operations are awaited with `Promise.allSettled`; the barrier verifies both settle successfully, leaves one publication target for the run, activates exactly one target, and completes the run with the expected publication owner.
- Reviewed the remaining lock-order barrier predicates: activation's advisory wait, flush's `collection_runs` wait, and overlapping publication's global `aggregate_publications` wait remain aligned with their respective lock holders.

## Verification

- `bunx vitest run apps/collector/src/services/publish.integration.test.ts --reporter=verbose` — 19 PostgreSQL-gated tests skipped because `TEST_DATABASE_URL` is not configured.
- `bun run test` — 194 passed, 60 PostgreSQL-gated skipped.
- `bun run typecheck` — all workspaces passed.
- `bunx drizzle-kit check` — passed.
- `bun run db:generate` twice — both reported no schema changes.
- `git diff --check` — passed.

## Residual concerns

The corrected runtime PostgreSQL barrier remains gated until a `TEST_DATABASE_URL` is available.
