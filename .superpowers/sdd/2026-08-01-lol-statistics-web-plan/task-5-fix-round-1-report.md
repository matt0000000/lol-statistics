# Task 5 fix round 1

## Implemented

- Moved home-page dataset freshness calculation to the server and passed an explicit state into the client `ChampionGrid`; warming datasets now show warming copy instead of a false empty-search result.
- Hardened `public_status` so an active publication must belong to the current patch. Added a PostgreSQL-gated stale/corrupted pointer regression and status fixture assertions for patch-scoped run status, stage, and counters.
- Added versioned public methodology collector rules (300-second minimum, early-surrender remake rejection, exact canonical team-position mapping) and rendered methodology formulas, minimum, limitations, and rules from that contract.
- Added content privacy assertions covering PUUID, match-history, private error/detail, Riot key, and match identifier leakage; preserved the exact Riot legal notice and no Arena support claim.

## Verification

- `bunx vitest run apps/web/components/ChampionGrid.test.tsx` — 5 passed.
- `bunx vitest run apps/web/tests/content.test.tsx` — 3 passed.
- `bun --filter @lol/web typecheck` — passed.
- `bun --filter @lol/public-api typecheck` — passed.
- `bunx vitest run` — 42 files passed, 309 tests passed; 8 files/71 tests skipped (PostgreSQL-gated).
- `bunx vitest run packages/public-api/src/queries.integration.test.ts` — skipped because `TEST_DATABASE_URL`/PostgreSQL is unavailable.

## Residual risk

PostgreSQL integration coverage was added but not executed in this environment. The public methodology contract is versioned in the public-api package and currently rendered from its exported contract constant; consumers should update that constant and schema together for future methodology revisions.
