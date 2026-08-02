# Final fix E — rejected-only audit refresh

Base: `1bdce97`

Implemented the rejected-only replay state machine:

- Exact canonical comparison remains the first decision. Identical retries are
  replayed without changing canonical rows or counters.
- A later collection run may replace participant rejection rows for an
  immutable-identical `REJECTED` match only when no accepted observations
  exist and every incoming participant is rejected. The replacement and the
  new run's `matchesIngested`/`observationsRejected` increments are one
  transaction.
- `REJECTED` → `VALID` promotion remains supported. `VALID` canonical rows,
  including partial-valid matches with rejection rows, remain immutable;
  changed replays fail closed. An impossible rejected row with observations
  also fails closed. Accepted observations, items, and boots are never
  deleted by the refresh path.
- Collector operations documentation now distinguishes same-patch publication
  preservation from intentional patch-rollover warming and documents
  rejected-only audit refresh semantics.

Verification:

- `bun run test` — 48 files passed, 388 tests passed; 9 PG-gated files (80
  tests) skipped because `TEST_DATABASE_URL` is unset.
- Focused pure state tests — 2 passed.
- `bun run typecheck` — all workspaces passed.
- `bun run db:generate` twice — no schema changes.
- `bunx drizzle-kit check` — passed.
- `bun run build` — Next.js production build passed.
- `git diff --check` — passed.

