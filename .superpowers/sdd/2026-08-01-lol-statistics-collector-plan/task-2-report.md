# Task 2 Report: League-V4 and Match-V5 Typed Clients

## Status

Implemented and verified. League discovery is pinned to TR1, Match-V5 to Europe, and all boundary responses are parsed through Zod DTOs.

## TDD evidence

### RED

Added `league.test.ts` and `match.test.ts` before the clients/contracts. The focused run failed because `./league` and `./match` did not exist:

```text
bunx vitest run packages/riot-client/src/league.test.ts packages/riot-client/src/match.test.ts
FAIL: Cannot find module './league' / './match'
```

### GREEN

Implemented pagination, apex routing, deterministic PUUID deduplication, Match-V5 list/get methods, URL segment encoding, input validation, and sanitized fixtures.

```text
bunx vitest run packages/riot-client
PASS: 3 files, 42 tests
bun run typecheck
PASS: all workspace packages
git diff --check
PASS
```

## Boundary decisions

- League Emerald/Diamond divisions run in fixed tier/division order and continue until an empty page. Apex requests run once each in Master, Grandmaster, Challenger order.
- Duplicate PUUIDs keep the highest tier. Same-tier duplicates keep the first response encountered; final output is sorted by descending tier priority then PUUID for repeatable runs.
- `MatchClient` owns the 35-day discovery-window check: `startTime` is a nonnegative Unix-second integer no older than 35 days and no later than the injected/current clock. `start` is a nonnegative safe integer.
- Match metadata participant PUUIDs and `info.participants[].puuid` are checked for exact multiset equality by `matchSchema` at the boundary.
- Match IDs are constrained to the TR1 numeric form (`TR1_<digits>`) for list results and `getMatch` paths.

## Remaining concerns

No known blockers. The League contract intentionally requires the brief's `puuid` field even though some raw League-V4 production payload variants omit it; callers must provide/enrich that field before this boundary.
