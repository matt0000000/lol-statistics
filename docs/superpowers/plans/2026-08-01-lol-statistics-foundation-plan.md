# LoL Statistics Foundation and Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the tested TypeScript workspace, PostgreSQL schema, Data Dragon synchronization, and deterministic item catalog required by the TR item-statistics product.

**Architecture:** A Bun workspace separates the collector, web application, and focused shared packages. PostgreSQL is the canonical store; Data Dragon metadata is validated at the boundary and normalized by a pure, patch-aware classifier before persistence.

**Tech Stack:** Bun, TypeScript, Next.js, PostgreSQL 17, Drizzle ORM, Zod, Vitest, Docker Compose

## Global Constraints

- Scope is TR1, queue `420`, Emerald through Challenger, current TR realm patch only.
- The browser must never receive the Riot API key or a PUUID.
- Roles are `TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM`, and `UTILITY`; the UI later labels `UTILITY` as Support.
- Core items, upgraded boots, and excluded items are distinct categories.
- Components, starters, consumables, trinkets, quest/support progression items, and mode-specific items are excluded.
- All persisted identifiers and timestamps use deterministic database constraints and UTC.
- Use test-driven development and commit after every task.

## File Structure

```text
.
├── apps/
│   ├── collector/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/config.ts
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.ts
│       └── app/layout.tsx
├── fixtures/riot/
│   ├── ddragon-items-16.15.1.json
│   ├── ddragon-champions-16.15.1.json
│   └── tr-realm-16.15.1.json
├── packages/
│   ├── database/src/{client,schema}.ts
│   ├── domain/src/{index,patch,role}.ts
│   └── item-catalog/src/{classifier,contracts,index,normalize,sync}.ts
├── drizzle.config.ts
├── migrations/
├── compose.yaml
├── package.json
├── tsconfig.base.json
└── vitest.config.ts
```

---

### Task 1: Reproducible Workspace and Local Database

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `compose.yaml`
- Create: `.env.example`
- Create: `apps/collector/package.json`
- Create: `apps/collector/tsconfig.json`
- Create: `apps/collector/src/config.ts`
- Create: `apps/collector/src/config.test.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/app/layout.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: none
- Produces: `CollectorConfig`, root workspace scripts, and a local PostgreSQL service on port `5432`

- [ ] **Step 1: Add workspace manifests and dependencies**

Use these workspace scripts and install commands; commit the generated `bun.lock`:

```json
{
  "name": "tr-lol-item-statistics",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun --filter @lol/web dev",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "bun --filter '*' typecheck",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "bun --filter @lol/database migrate"
  }
}
```

Use `"type": "module"` in every package. `apps/collector/package.json` defines `typecheck`, `test`, and `catalog:sync`; `apps/web/package.json` defines `dev`, `build`, `start`, `typecheck`, and `test`. Each shared package exports `./src/index.ts` and defines `typecheck` and `test` scripts.

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    projects: [{
      test: {
        name: "node",
        environment: "node",
        include: ["apps/collector/**/*.test.ts", "packages/**/*.test.ts"]
      }
    }]
  }
});
```

```bash
bun add -d typescript vitest drizzle-kit @types/node
bun add zod drizzle-orm postgres
bun add --cwd apps/web next react react-dom
bun add --cwd apps/web -d @types/react @types/react-dom
```

Configure Next.js to serve only Riot's official Data Dragon image host:

```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "ddragon.leagueoflegends.com", pathname: "/cdn/**" }] }
};
export default config;
```

- [ ] **Step 2: Write the failing configuration test**

```ts
import { describe, expect, it } from "vitest";
import { readCollectorConfig } from "./config";

describe("readCollectorConfig", () => {
  it("rejects an absent Riot key and accepts a complete environment", () => {
    expect(() => readCollectorConfig({ DATABASE_URL: "postgres://db" })).toThrow("RIOT_API_KEY");
    expect(readCollectorConfig({
      DATABASE_URL: "postgres://db",
      RIOT_API_KEY: "RGAPI-test",
      RIOT_PLATFORM: "TR1",
      RIOT_REGION: "EUROPE"
    })).toEqual({
      databaseUrl: "postgres://db",
      riotApiKey: "RGAPI-test",
      platform: "TR1",
      region: "EUROPE"
    });
  });
});
```

- [ ] **Step 3: Run the test and verify the failure**

Run: `bunx vitest run apps/collector/src/config.test.ts`  
Expected: FAIL because `./config` does not exist.

- [ ] **Step 4: Implement validated server-only configuration**

```ts
import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().min(1),
  RIOT_API_KEY: z.string().min(1),
  RIOT_PLATFORM: z.literal("TR1").default("TR1"),
  RIOT_REGION: z.literal("EUROPE").default("EUROPE")
});

export type CollectorConfig = {
  databaseUrl: string;
  riotApiKey: string;
  platform: "TR1";
  region: "EUROPE";
};

export function readCollectorConfig(environment: Record<string, string | undefined>): CollectorConfig {
  const parsed = environmentSchema.parse(environment);
  return {
    databaseUrl: parsed.DATABASE_URL,
    riotApiKey: parsed.RIOT_API_KEY,
    platform: parsed.RIOT_PLATFORM,
    region: parsed.RIOT_REGION
  };
}
```

The checked-in `.env.example` contains only `DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats`, `DATABASE_READ_URL=postgres://lol:lol@localhost:5432/lol_stats`, `RIOT_PLATFORM=TR1`, `RIOT_REGION=EUROPE`, `PUBLIC_SITE_URL=http://localhost:3000`, and an empty `RIOT_API_KEY=`. `compose.yaml` defines PostgreSQL 17 with database/user/password `lol`, a named volume, and a healthcheck using `pg_isready`.

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: lol_stats
      POSTGRES_USER: lol
      POSTGRES_PASSWORD: lol
    ports: ["5432:5432"]
    volumes: ["lol-postgres:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lol -d lol_stats"]
      interval: 2s
      timeout: 2s
      retries: 20
volumes:
  lol-postgres: {}
```

- [ ] **Step 5: Verify workspace and database startup**

Run: `bunx vitest run apps/collector/src/config.test.ts && bun run typecheck`  
Expected: PASS with no TypeScript errors.

Run: `docker compose config`  
Expected: exits `0` and shows one PostgreSQL service without interpolating a Riot key.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock tsconfig.base.json vitest.config.ts compose.yaml .env.example .gitignore apps
git commit -m "build: establish TypeScript workspace"
```

---

### Task 2: Patch and Role Domain Primitives

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/src/patch.ts`
- Create: `packages/domain/src/patch.test.ts`
- Create: `packages/domain/src/role.ts`
- Create: `packages/domain/src/role.test.ts`
- Create: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: TypeScript and Vitest workspace from Task 1
- Produces: `PatchKey`, `toPatchKey(version)`, `Role`, `parseTeamPosition(value)`, and `roleLabel(role)`

- [ ] **Step 1: Write failing domain tests**

```ts
import { describe, expect, it } from "vitest";
import { toPatchKey } from "./patch";

describe("toPatchKey", () => {
  it("uses only the major and minor game-version components", () => {
    expect(toPatchKey("16.15.623.1234")).toBe("16.15");
    expect(() => toPatchKey("16")).toThrow("Invalid Riot version");
  });
});
```

```ts
import { describe, expect, it } from "vitest";
import { parseTeamPosition, roleLabel } from "./role";

describe("roles", () => {
  it("accepts Riot positions and labels utility as support", () => {
    expect(parseTeamPosition("UTILITY")).toBe("UTILITY");
    expect(roleLabel("UTILITY")).toBe("Support");
    expect(parseTeamPosition("INVALID")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests and verify missing-module failures**

Run: `bunx vitest run packages/domain/src/patch.test.ts packages/domain/src/role.test.ts`  
Expected: FAIL because the domain modules do not exist.

- [ ] **Step 3: Implement the primitives**

```ts
export type PatchKey = `${number}.${number}`;

export function toPatchKey(version: string): PatchKey {
  const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(version);
  if (!match) throw new Error(`Invalid Riot version: ${version}`);
  return `${Number(match[1])}.${Number(match[2])}`;
}
```

```ts
export const ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"] as const;
export type Role = (typeof ROLES)[number];

export function parseTeamPosition(value: string): Role | null {
  return ROLES.find((role) => role === value) ?? null;
}

export function roleLabel(role: Role): string {
  return role === "UTILITY" ? "Support" : role[0] + role.slice(1).toLowerCase();
}
```

- [ ] **Step 4: Export and verify**

`packages/domain/src/index.ts` exports every public symbol from `patch.ts` and `role.ts`.

Run: `bunx vitest run packages/domain && bun run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat: add patch and role primitives"
```

---

### Task 3: Canonical PostgreSQL Schema and Migrations

**Files:**
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/schema.ts`
- Create: `packages/database/src/migrate.ts`
- Create: `packages/database/src/schema.integration.test.ts`
- Create: `packages/database/src/index.ts`
- Create: `drizzle.config.ts`
- Generate: `migrations/0000_initial.sql`

**Interfaces:**
- Consumes: `PatchKey` and `Role` from `@lol/domain`
- Produces: `createDatabase(url)`, Drizzle table exports, and unique constraints used by later repositories

- [ ] **Step 1: Write the failing schema integration test**

The test requires `TEST_DATABASE_URL` and skips only when it is absent:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { patches } from "./schema";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("canonical schema", () => {
  const database = createDatabase(url!);
  afterAll(() => database.close());

  it("stores a patch once by exact Data Dragon version", async () => {
    await database.db.insert(patches).values({ version: "16.15.1", patchKey: "16.15" }).onConflictDoNothing();
    await database.db.insert(patches).values({ version: "16.15.1", patchKey: "16.15" }).onConflictDoNothing();
    const rows = await database.db.select().from(patches).where(eq(patches.version, "16.15.1"));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and verify the failure**

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/schema.integration.test.ts`  
Expected: FAIL because database modules and migrations do not exist.

- [ ] **Step 3: Define the schema with exact keys**

Use Drizzle `pgTable` definitions with these primary and unique keys:

```ts
export const schemaContract = {
  patches: "pk(id), unique(version)",
  champions: "pk(patch_id, champion_id), unique(patch_id, slug)",
  items: "pk(patch_id, item_id)",
  collectionRuns: "pk(id), index(status, started_at)",
  ladderSnapshots: "pk(run_id, puuid), index(run_id, tier)",
  matches: "pk(match_id), index(patch_id, validation_state)",
  participantObservations: "pk(match_id, participant_id), index(patch_id, champion_id, role)",
  participantCoreItems: "pk(match_id, participant_id, slot_index)",
  participantBoots: "pk(match_id, participant_id)",
  aggregatePublications: "pk(id), unique active partial index",
  itemAggregates: "pk(publication_id, champion_id, role, item_id)",
  combinationAggregates: "pk(publication_id, champion_id, role, size, combination_key)",
  bootsAggregates: "pk(publication_id, champion_id, role, item_id)"
} as const;
```

The actual table columns match Section 8 of the design spec. Use `timestamptz` for timestamps, `bigint` for Riot game IDs when numeric, text for PUUID/match ID, integer counts, JSONB only for structured error details and raw final-slot arrays, and enums/check constraints for run status, validation state, role, tier, and item category.

- [ ] **Step 4: Implement the database factory and migration entry point**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDatabase(url: string) {
  const sql = postgres(url, { max: 10 });
  return { db: drizzle(sql, { schema }), close: () => sql.end() };
}
```

`migrate.ts` calls `drizzle-orm/postgres-js/migrator` with `migrationsFolder: "./migrations"`, awaits completion, closes the connection in `finally`, and exits nonzero on failure.

- [ ] **Step 5: Generate, apply, and verify the migration**

Run: `bun run db:generate && bun run db:migrate`  
Expected: one checked-in initial SQL migration applies cleanly.

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/schema.integration.test.ts`  
Expected: PASS, including a second execution against the already-migrated database.

- [ ] **Step 6: Commit**

```bash
git add packages/database drizzle.config.ts migrations package.json bun.lock
git commit -m "feat: add canonical statistics schema"
```

---

### Task 4: Data Dragon Contracts and TR Realm Client

**Files:**
- Create: `packages/item-catalog/package.json`
- Create: `packages/item-catalog/tsconfig.json`
- Create: `packages/item-catalog/src/contracts.ts`
- Create: `packages/item-catalog/src/client.ts`
- Create: `packages/item-catalog/src/client.test.ts`
- Create: `fixtures/riot/tr-realm-16.15.1.json`
- Create: `fixtures/riot/ddragon-items-16.15.1.json`
- Create: `fixtures/riot/ddragon-champions-16.15.1.json`

**Interfaces:**
- Consumes: `toPatchKey(version)` from `@lol/domain`
- Produces: `DataDragonClient`, `RealmDto`, `ChampionDto`, enriched `ItemDto` with numeric `id`, and validated fixture loaders

- [ ] **Step 1: Add sanitized official fixtures**

The realm fixture contains `v`, `dd`, `l`, and `cdn`. Champion fixtures include one normal champion and stable numeric `key`. Item fixtures cover a completed core item, upgraded boots, component, starter, consumable, trinket, support item, Ornn upgrade, and non-Summoner's-Rift item. Keep only fields represented by the runtime schemas.

- [ ] **Step 2: Write the failing client test**

```ts
import { describe, expect, it, vi } from "vitest";
import { DataDragonClient } from "./client";

describe("DataDragonClient", () => {
  it("uses the TR realm version for both catalogs", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://cdn" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })));
    const client = new DataDragonClient(fetcher);
    const result = await client.fetchTrCatalog();
    expect(result.version).toBe("16.15.1");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://ddragon.leagueoflegends.com/realms/tr.json",
      "https://cdn/16.15.1/data/tr_TR/champion.json",
      "https://cdn/16.15.1/data/tr_TR/item.json"
    ]);
  });
});
```

- [ ] **Step 3: Run the test and verify the failure**

Run: `bunx vitest run packages/item-catalog/src/client.test.ts`  
Expected: FAIL because `DataDragonClient` does not exist.

- [ ] **Step 4: Implement validation and the client**

```ts
export class DataDragonClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async fetchTrCatalog(): Promise<{
    version: string;
    locale: string;
    champions: Record<string, ChampionDto>;
    items: ItemDto[];
  }> {
    const realm = realmSchema.parse(await this.getJson("https://ddragon.leagueoflegends.com/realms/tr.json"));
    const base = `${realm.cdn}/${realm.dd}/data/${realm.l}`;
    const champions = championCatalogSchema.parse(await this.getJson(`${base}/champion.json`));
    const items = itemCatalogSchema.parse(await this.getJson(`${base}/item.json`));
    const enrichedItems = Object.entries(items.data).map(([id, item]) => ({ ...item, id: Number(id) }));
    return { version: realm.dd, locale: realm.l, champions: champions.data, items: enrichedItems };
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`Data Dragon ${response.status}: ${url}`);
    return response.json();
  }
}
```

Zod schemas preserve the exact fields used later: item `name`, `description`, `gold`, `into`, `from`, `tags`, `maps`, `purchasable`, and image; champion `id`, numeric `key`, `name`, and image. `ItemDto` is the parsed item value intersected with `{ id: number }`; no later code reads a nonexistent Data Dragon value-level ID.

- [ ] **Step 5: Verify fixtures and type checks**

Run: `bunx vitest run packages/item-catalog/src/client.test.ts && bun run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/item-catalog fixtures/riot
git commit -m "feat: validate TR Data Dragon catalogs"
```

---

### Task 5: Deterministic Item Classification and Catalog Sync

**Files:**
- Create: `packages/item-catalog/src/overrides.ts`
- Create: `packages/item-catalog/src/classifier.ts`
- Create: `packages/item-catalog/src/classifier.test.ts`
- Create: `packages/item-catalog/src/normalize.ts`
- Create: `packages/item-catalog/src/normalize.test.ts`
- Create: `packages/item-catalog/src/sync.ts`
- Create: `packages/item-catalog/src/sync.integration.test.ts`
- Create: `packages/item-catalog/src/index.ts`
- Create: `apps/collector/src/commands/sync-catalog.ts`
- Modify: `apps/collector/package.json`

**Interfaces:**
- Consumes: `DataDragonClient`, Data Dragon DTOs, and database tables from Tasks 3–4
- Produces: `classifyItem(item, overrides)`, `normalizeItemId(itemId, aliases)`, `syncCatalog(database, catalog)`, and `bun run catalog:sync`

- [ ] **Step 1: Write failing classification tests**

```ts
import { describe, expect, it } from "vitest";
import { classifyItem } from "./classifier";
import items from "../../../fixtures/riot/ddragon-items-16.15.1.json";

describe("classifyItem", () => {
  it.each([
    ["6672", "CORE"],
    ["3006", "BOOTS"],
    ["1038", "EXCLUDED_COMPONENT"],
    ["1055", "EXCLUDED_STARTER"],
    ["2003", "EXCLUDED_CONSUMABLE"],
    ["3340", "EXCLUDED_TRINKET"]
  ] as const)("classifies %s as %s", (id, expected) => {
    expect(classifyItem({ ...items.data[id], id: Number(id) }, {})).toMatchObject({ category: expected });
  });
});
```

```ts
import { expect, it } from "vitest";
import { normalizeItemId } from "./normalize";

it("normalizes an Ornn upgrade and preserves an ordinary item", () => {
  expect(normalizeItemId(7002, { 7002: 3031 })).toBe(3031);
  expect(normalizeItemId(6672, { 7002: 3031 })).toBe(6672);
});
```

- [ ] **Step 2: Run tests and verify the failure**

Run: `bunx vitest run packages/item-catalog/src/classifier.test.ts packages/item-catalog/src/normalize.test.ts`  
Expected: FAIL because classification modules do not exist.

- [ ] **Step 3: Implement ordered classification rules**

```ts
export type ItemCategory =
  | "CORE"
  | "BOOTS"
  | "EXCLUDED_COMPONENT"
  | "EXCLUDED_STARTER"
  | "EXCLUDED_CONSUMABLE"
  | "EXCLUDED_TRINKET"
  | "EXCLUDED_SUPPORT"
  | "EXCLUDED_MODE"
  | "EXCLUDED_UNKNOWN";

export function classifyItem(item: ItemDto, overrides: Record<number, ItemCategory>): { category: ItemCategory; reason: string } {
  const forced = overrides[Number(item.id)];
  if (forced) return { category: forced, reason: "patch override" };
  if (item.maps?.["11"] !== true) return { category: "EXCLUDED_MODE", reason: "not enabled on map 11" };
  if (item.tags.includes("Trinket")) return { category: "EXCLUDED_TRINKET", reason: "trinket" };
  if (item.tags.includes("Consumable")) return { category: "EXCLUDED_CONSUMABLE", reason: "consumable" };
  if (item.tags.includes("Boots") && item.into === undefined) return { category: "BOOTS", reason: "completed boots" };
  if (item.into && item.into.length > 0) return { category: "EXCLUDED_COMPONENT", reason: "builds into another item" };
  if (!item.purchasable) return { category: "EXCLUDED_UNKNOWN", reason: "not purchasable" };
  if (item.gold.total <= 500) return { category: "EXCLUDED_STARTER", reason: "starter-price terminal item" };
  return { category: "CORE", reason: "purchasable terminal map-11 item" };
}
```

The patch override map explicitly classifies support quest lines and any Data Dragon exception. `normalizeItemId` performs one alias lookup and rejects alias cycles during catalog synchronization.

- [ ] **Step 4: Write the failing synchronization test**

The integration test loads all three fixtures, invokes `syncCatalog`, then asserts one patch row, champion rows with numeric IDs, every fixture item with a category/reason, and `normalized_base_id = 3031` for fixture item `7002`. Running it twice must leave row counts unchanged.

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/item-catalog/src/sync.integration.test.ts`  
Expected: FAIL because `syncCatalog` does not exist.

- [ ] **Step 5: Implement transactional synchronization and CLI**

```ts
export async function syncCatalog(database: Database, catalog: DataDragonCatalog): Promise<{ patchId: number; champions: number; items: number }> {
  return database.db.transaction(async (transaction) => {
    const patchId = await upsertPatch(transaction, catalog.version);
    const champions = await upsertChampions(transaction, patchId, catalog.champions);
    const items = await upsertClassifiedItems(transaction, patchId, catalog.items, overridesFor(catalog.version));
    return { patchId, champions, items };
  });
}
```

`Database` is `ReturnType<typeof createDatabase>`. `DataDragonCatalog` is `Awaited<ReturnType<DataDragonClient["fetchTrCatalog"]>>`. The private helpers have these signatures and contain the stated Drizzle upserts: `upsertPatch(transaction, version): Promise<number>`, `upsertChampions(transaction, patchId, champions): Promise<number>`, and `upsertClassifiedItems(transaction, patchId, items, overrides): Promise<number>`.

The CLI loads `readCollectorConfig(process.env)`, creates the database, calls `new DataDragonClient().fetchTrCatalog()`, synchronizes it, prints counts without identifiers or secrets, closes the database, and exits nonzero on validation failure.

- [ ] **Step 6: Verify the foundation phase**

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/domain packages/database packages/item-catalog`  
Expected: PASS.

Run: `bun run typecheck && git diff --check`  
Expected: both exit `0`.

- [ ] **Step 7: Commit**

```bash
git add packages/item-catalog apps/collector package.json bun.lock
git commit -m "feat: synchronize classified item catalog"
```

## Phase Acceptance Check

Run from a clean checkout:

```bash
bun install --frozen-lockfile
docker compose up -d postgres
bun run db:migrate
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bun run test
bun run typecheck
```

Expected: all commands pass; catalog fixture synchronization is idempotent; no application code imports `RIOT_API_KEY` outside `apps/collector`.
