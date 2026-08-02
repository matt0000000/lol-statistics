# Task 1 report: ladder lifecycle telemetry

## Implementation

Added optional structured logging to the ladder snapshot service and wired the production `LADDER` stage logger through. The service now emits `ladder_fetch_started`, `ladder_fetch_completed`, `ladder_persist_started`, and `ladder_persist_completed` with the run ID, `LADDER` stage, and fetched aggregate count where available. Failure paths stop at the boundary that failed, and no entry payloads or exception details are logged.

## RED/GREEN evidence

- RED: `bunx vitest run apps/collector/src/services/snapshot-ladder.test.ts` — 3 lifecycle tests failed (the captured event arrays were empty because `SnapshotLadderInput` had no logger support); the 3 existing tests passed.
- GREEN: `bunx vitest run apps/collector/src/services/snapshot-ladder.test.ts` — 1 file passed, 6 tests passed.
- Typecheck: `bunx tsc --noEmit -p apps/collector/tsconfig.json` — passed.
- Diff check: `git diff --check` — passed before commit.

## Files changed

- `apps/collector/src/services/snapshot-ladder.test.ts`
- `apps/collector/src/services/snapshot-ladder.ts`
- `apps/collector/src/commands/collect.ts`

## Commit

`2674dbc02ea229cb98d207ea5813c2d4fef31e69` — `feat: add ladder lifecycle diagnostics`

## Self-review

The logger is optional, uses the existing structured `info` method shape, and is invoked immediately before and after each Riot-fetch/database-persist boundary. Event fields are static/allowlisted values plus the run ID and count; PUUIDs and dependency messages never enter logger payloads. Existing error wrapping and invalid-input behavior remain unchanged.

## Concerns

No known blockers. Full PostgreSQL-backed collection execution was not attempted; this task is covered by the focused service tests and collector typecheck.

## Fix round 1: best-effort lifecycle telemetry

Review identified that a throwing `logger.info` call was caught by `snapshotLadder`'s dependency wrapper, which could fail/retry a stage after persistence had succeeded. Added a regression test with a throwing logger asserting the snapshot resolves and repository persistence is still invoked. Wrapped lifecycle `info` emission in a local best-effort helper that swallows logger errors while leaving fetch/persist errors unchanged.

- RED: `bunx vitest run apps/collector/src/services/snapshot-ladder.test.ts` — new logger-failure test failed because the logger exception became `dependency_failure`; the other 6 tests passed.
- GREEN: `bunx vitest run apps/collector/src/services/snapshot-ladder.test.ts` — 1 file passed, 7 tests passed.
- Typecheck: `bunx tsc --noEmit -p apps/collector/tsconfig.json` — passed.
- Diff check: `git diff --check` — passed.
