# Final Fix Report: Ladder Failure Diagnostics

Date: 2026-08-02

## Scope

- Made terminal `collection_failed` logging best-effort in `runCollection` so a logger/sink exception cannot replace the original stage error.
- Added a regression test proving the original error identity, category, and sanitized failure detail reach rejection/`markFailed` when terminal logging throws.
- Added focused coverage for cyclic causes and invalid/lowercase diagnostic-code omission.
- Marked the completed Task 1–3 plan checkboxes in the ladder diagnostics plan.

## TDD evidence

1. Added the logger-failure regression test before changing production code.
2. RED verification:

   `bunx vitest run apps/collector/src/pipeline.test.ts`

   Result: 1 failed, 6 passed. The test rejected with `Error: logger unavailable` instead of the expected original stage error, reproducing the masking bug.

3. Implemented the minimal `try/catch` around terminal logger invocation.
4. GREEN verification:

   `bunx vitest run apps/collector/src/pipeline.test.ts`

   Result: 1 file passed, 7 tests passed.

## Verification

- `bunx vitest run apps/collector/src/pipeline.test.ts apps/collector/src/logger.test.ts apps/collector/src/services/snapshot-ladder.test.ts` — 3 files, 18 tests passed.
- `bunx vitest run apps/collector/src` — 10 files passed, 2 skipped; 62 tests passed, 20 skipped.
- `bun run test` — 48 files passed, 9 skipped; 401 tests passed, 83 skipped.
- `bun --filter @lol/collector typecheck` — passed.
- `bun run typecheck` — all workspace packages passed.
- `bun run build` — Next.js production build passed (existing workspace-root lockfile warning only).
- `git diff --check` — passed.

`bun --filter @lol/collector test` was also attempted, but the workspace script resolves the root Vitest config and exits 1 with “No test files found”; the direct collector test command above passed.

## Self-review

- The catch is scoped only to the terminal logger call; stage execution and `markFailed` behavior are unchanged.
- The original error is rethrown unchanged after diagnostics are attempted.
- Cause traversal remains cycle-safe and only emits uppercase allowlisted diagnostic codes; lowercase/invalid codes are omitted.
- No secret-bearing fields or arbitrary exception messages were added to logs.
