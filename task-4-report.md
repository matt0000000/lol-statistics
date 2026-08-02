# Task 4 report — statistics workspace

Implemented the champion statistics workspace for explicit roles.

- Added strict async search-parameter parsing and safe defaults (`view=items`, `sort=adjusted`, `lowConfidence` only when exactly `1`); no role is inferred.
- Wired `PublicQueries.stats` with opaque warming/champion/role/error states and canonical slug/query redirects.
- Added view tabs, URL-addressable sort controls, confidence toggle, semantic evidence table, baseline summary, empty states, responsive card CSS, and exact correlation limitation copy.
- Added finite, locale-stable formatters for rates, deltas, intervals, games, and publication age.
- Extended public stat rows and public SQL views with active-patch Data Dragon item metadata for every item id.

Verification:

- `bun run test` — 286 passed, 69 skipped (355 total)
- `bun run typecheck` — all workspace packages passed
- `bun --filter @lol/web build` — production build passed
- `bun run db:generate` (twice) — no schema changes, no migration generated
