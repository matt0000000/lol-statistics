# Broad web review fix round 2

## Changes

- Reordered rendered `StatsTable` cells to match the eight semantic headers: Build, Adjusted score, Win rate, Baseline delta, Build rate, Sample games, 95% CI, and Confidence.
- Added a rendered-DOM regression that checks every header against the corresponding cell `data-label` and known first-row value, including Build, Build rate, and 95% CI. This also protects the responsive/mobile data-label presentation.

## Verification

- `bunx vitest run apps/web/components/StatsTable.test.tsx` — 3 passed (the new regression failed before the production reorder, then passed after it).
- `bun run test` — 336 passed, 71 skipped (407 total).
- `bun run typecheck` — all workspace packages passed.
- `bun --filter @lol/web build` — production build passed.
- `git diff --check` — passed.
