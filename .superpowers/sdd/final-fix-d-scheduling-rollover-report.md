# Final fix D — scheduling rollover and out-of-patch checkpointing

Base: `26a7d19`

Implemented:

- Scheduled `resumeOrCreate` now considers only admissible `PENDING`, `RUNNING`,
  and `FAILED` runs. `COMPLETED` runs remain immutable history; the next
  invocation creates a fresh coverage window while the prior publication stays
  active until publication.
- Added payload-free `OutOfScopeMatchError` handling before canonical save.
  Collector workers checkpoint the discovered row transactionally and count a
  bounded participant rejection total. Repeated checkpoints are idempotent.
  Legacy rejected canonical rows from another patch are detected before Riot
  refetch and checkpointed the same way.
- Enforced repository patch identity before any canonical match insert and
  documented immutable participant-level rejections for valid matches. Changed
  partial-valid replays fail closed; all-rejected matches remain eligible for
  later ladder re-evaluation.

Verification:

- `bun run test` — 47 files passed, 386 tests passed, 9 PG-gated files skipped.
- `bun run typecheck` — all workspaces passed.
- `bun run db:generate` twice — no schema changes.
- `bun run build` — Next.js production build passed.
- `git diff --check` — passed.
- PostgreSQL integration tests were skipped because `TEST_DATABASE_URL` is
  unset in this environment.
