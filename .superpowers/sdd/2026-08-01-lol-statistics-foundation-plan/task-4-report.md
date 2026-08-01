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

The initial implementation included a 7002 Ornn-upgrade record even though that ID is not present in the current 16.15.1 Data Dragon dump; Fix Round 1 moves that alias into a separate versioned override fixture. Live Data Dragon and PostgreSQL integration were not run as part of this task.

## Fix Round 1

### Changes

- Required canonical decimal item record keys and safe, nonnegative integer IDs before enrichment; champion string and numeric keys now receive the same safe-integer validation.
- Added regression tests for unsafe champion keys and non-decimal item keys (`1e3`, `0x10`, `+1`, and whitespace forms).
- Corrected official 16.15.1 fixture values for item 3006's duplicate 1042 component and item 1038's complete `into` list.
- Removed the unavailable 7002 record from the official 16.15.1 item fixture and moved its alias into the explicitly versioned `fixtures/riot/item-aliases-16.15.1.json` fixture.

### TDD evidence

RED command:

```text
bunx vitest run packages/item-catalog/src/client.test.ts
```

Result: 6 expected failures: unsafe champion key accepted, official fixture still contained 7002, and all four malformed item keys were coerced into numeric IDs.

GREEN command:

```text
bunx vitest run packages/item-catalog/src/client.test.ts
```

Result: 9 passed.

### Verification

- `bunx vitest run packages/domain packages/database packages/item-catalog` — 15 passed, 1 database integration test skipped without `TEST_DATABASE_URL`.
- `bun run typecheck` — all five workspaces passed.
- `git diff --check` — clean.
- Live endpoint comparison against `https://ddragon.leagueoflegends.com/cdn/16.15.1/data/tr_TR/item.json` confirmed the corrected 3006/1038 fields and confirmed official 16.15.1 has no 7002 record.

### Fix files and commits

- `packages/item-catalog/src/contracts.ts`, `packages/item-catalog/src/client.ts`, `packages/item-catalog/src/client.test.ts`
- `fixtures/riot/ddragon-items-16.15.1.json`, `fixtures/riot/item-aliases-16.15.1.json`
- Fix commit: `00a2997`; follows base task commits `1052bd6`, `8c3f109`, and `8244c11`.

### Residual concerns

The downstream classifier/sync implementation must load the versioned alias fixture or its equivalent override map when normalizing 7002; it must not treat 7002 as an official active-patch catalog row.

## Fix Round 2

### Changes

- Tightened canonical decimal syntax to exactly `0` or a nonzero digit followed by digits, rejecting leading-zero keys consistently for champion strings and item record keys.
- Added regression coverage for champion `01`, item `01`/`001`/`000`, the colliding `1` + `01` catalog, and unsafe item key `9007199254740993`.

### TDD evidence

RED command:

```text
bunx vitest run packages/item-catalog/src/client.test.ts
```

Result: 5 expected failures before implementation: leading-zero champion/item keys were accepted and colliding item IDs were returned instead of rejected.

GREEN command:

```text
bunx vitest run packages/item-catalog/src/client.test.ts
```

Result: 13 passed.

### Verification

- `bunx vitest run packages/domain packages/database packages/item-catalog` — 19 passed, 1 database integration test skipped without `TEST_DATABASE_URL`.
- `bun run typecheck` — all five workspaces passed.
- `git diff --check` — clean.

### Files and commit

- `packages/item-catalog/src/contracts.ts`
- `packages/item-catalog/src/client.test.ts`
- Fix Round 2 commit: pending at report authoring.

### Residual concerns

The versioned 7002 alias remains intentionally separate from the official item fixture and must continue to be supplied through classifier overrides.
