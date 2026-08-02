# Final fix E — rejected-only audit refresh (round 1)

Base: `060a7c2`

Replaced timestamp-based rejection provenance with an explicit nullable
`participant_rejections.run_id` foreign key. Legacy rows remain `NULL`; every
new rejection write and refresh replacement records its collection run. Exact
canonical replays ignore provenance, while changed all-rejected audits may be
replaced only by a distinct run or by one all-legacy upgrade. Same-run and
mixed-provenance changes fail closed. Match row locks serialize concurrent
refreshes and counters increment once per replacement.

Impossible `REJECTED` matches containing observations now fail before any
upgrade or rejection deletion, including incoming `VALID` payloads. Rejection
provenance is internal and does not alter public contracts.

Verification:

- `bun run test` — 48 files passed, 390 tests passed; 9 PG-gated files (83
  tests) skipped because `TEST_DATABASE_URL` is unset.
- Focused state/schema tests — 15 passed.
- `bun run typecheck` — all workspaces passed.
- `bun run db:generate` twice — no schema changes.
- `git diff --check` — passed.
