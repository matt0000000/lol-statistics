# Task 4 Report: Data Dragon Contracts and TR Realm Client

## Implementation

- Added the `@lol/item-catalog` workspace package with strict TypeScript and Bun test/typecheck scripts.
- Added Zod contracts for TR realm descriptors, champion catalogs with numeric champion keys, item catalogs, and enriched numeric item IDs.
- Added validated parse/load helpers so fixture and live responses use the same schemas.
- Added `DataDragonClient`, which reads the fixed TR realm endpoint, validates the realm patch shape with `toPatchKey`, builds locale/versioned catalog URLs, checks HTTP errors, and enriches item record keys as numeric IDs.
- Added small sanitized 16.15.1 realm, champion, and item fixtures. The item fixture covers a completed core item, upgraded boots, component, starter, consumable, trinket, support item, Ornn upgrade (7002), and non-Summoner's-Rift item.

## TDD evidence

### RED

```text
bunx vitest run packages/item-catalog/src/client.test.ts
```

Failed as expected before implementation because `./client` did not exist.

### GREEN

```text
bunx vitest run packages/item-catalog/src/client.test.ts
```

Passed after implementation (5 tests), including URL construction, numeric key enrichment, invalid-ID rejection, fixture boundary validation, and sanitized fixture loading.

## Verification

- `bunx vitest run packages/item-catalog/src/client.test.ts` — 5 passed.
- `bunx vitest run packages/domain packages/database packages/item-catalog` — 11 passed, 1 database integration test skipped because no test database URL was set.
- `bun run test` — 11 passed, 1 skipped.
- `bun run typecheck` — all five workspaces passed, including `@lol/item-catalog`.
- `git diff --cached --check` — clean before commit.

## Files changed

- `packages/item-catalog/package.json`
- `packages/item-catalog/tsconfig.json`
- `packages/item-catalog/src/contracts.ts`
- `packages/item-catalog/src/client.ts`
- `packages/item-catalog/src/client.test.ts`
- `packages/item-catalog/src/index.ts`
- `fixtures/riot/tr-realm-16.15.1.json`
- `fixtures/riot/ddragon-champions-16.15.1.json`
- `fixtures/riot/ddragon-items-16.15.1.json`
- `bun.lock`

## Commit

`1052bd6 feat: validate TR Data Dragon catalogs`

## Remaining concerns

The fixture includes the 7002 Ornn-upgrade record required by the downstream catalog plan; that ID is not present in the current 16.15.1 Data Dragon dump, so its sanitized metadata is retained from Riot's earlier official schema while keeping the fixture narrowly scoped. Live Data Dragon and PostgreSQL integration were not run as part of this task.
