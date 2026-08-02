# Task 4 fix round 2 report

Implemented the strict Wilson-score contract and fixture corrections.

## Changes

- `publicStatRowSchema` now recomputes `wilson95(wins, sample)` from `@lol/domain` and validates both interval bounds and recommended adjusted scores within the documented `1e-9` tolerance.
- `publicStatsResponseSchema` rejects low-confidence or below-threshold rows when `includeLowConfidence` is false, while allowing valid low rows when it is true; empty result sets remain valid.
- Added exact Wilson vectors, tolerance-boundary tests, visibility-invariant tests, and schema-parsed fixture construction.
- Updated UI/API and sorting fixtures to derive confidence intervals and adjusted scores from the shared Wilson helper. The UI example now uses 55/100, which deliberately renders `45.2%–64.4%`.

## Verification

- `bun run test` — 299 passed, 69 skipped (368 total)
- `bun run typecheck` — all workspace packages passed
- `bun --filter @lol/web build` — production build passed
- `bun run db:generate` — no schema changes, nothing to migrate
- `git diff --check` — passed

Commit: `d792e26` (`fix web statistics contract fixtures`)
