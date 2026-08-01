# Task 5 report — canonical combinations and confidence statistics

## Implementation

- Added numeric canonical multiset keys and unique size-N combinations, preserving duplicate quantities without mutating inputs.
- Added validated Wilson 95% intervals and aggregate metrics (raw/baseline rates, build rate, delta, losses, confidence bounds, adjusted score, and recommendation threshold).
- Exported both modules from `@lol/domain`.

## Verification

- RED: `bunx vitest run packages/domain/src/combinations.test.ts packages/domain/src/statistics.test.ts` failed because the new modules were absent.
- GREEN: the same focused command passed — 2 files, 13 tests.
- `bunx vitest run packages/domain` — 5 files, 34 tests passed.
- `bun run typecheck` — all workspace packages passed.
- `git diff --check` — clean.

## Commit

- `97f654c` — `feat: calculate item combination confidence metrics`
