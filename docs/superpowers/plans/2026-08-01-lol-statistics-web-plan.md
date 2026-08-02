# LoL Statistics Public API and Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the read-only API and responsive champion statistics website for the active TR1 Emerald+ Ranked Solo publication.

**Architecture:** Next.js App Router server code reads publication-scoped PostgreSQL views through a restricted query package. Server-rendered champion pages expose fixed scope and freshness; small client components handle search, explicit role selection, view switching, and sorting without ever receiving private identifiers.

**Tech Stack:** Bun, TypeScript, Next.js, React, PostgreSQL 17, Drizzle ORM, Zod, Vitest, Testing Library, Playwright, CSS Modules

## Global Constraints

- Complete the foundation/catalog and collector/statistics plans first.
- Public scope is fixed to TR1, Ranked Solo (`420`), Emerald+, current TR realm patch.
- A champion page has no preselected role; the visitor explicitly chooses an available role.
- `UTILITY` is displayed as Support.
- Views are Items, 2-item builds, 3-item builds, and Boots.
- Default sorting uses adjusted score; optional sorts are raw win rate, baseline difference, build rate, and sample.
- Results below 100 games are hidden by default and clearly marked when shown.
- Every results page shows patch, scope, coverage start, publication time, baseline, sample, and correlation warning.
- The web process cannot select PUUIDs, raw observations, Riot secrets, or individual match history.
- Use test-driven development and commit after every task.

## File Structure

```text
apps/web/
├── app/
│   ├── api/
│   │   ├── champions/route.ts
│   │   ├── champions/[championId]/route.ts
│   │   ├── champions/[championId]/roles/[role]/stats/route.ts
│   │   ├── meta/route.ts
│   │   └── methodology/route.ts
│   ├── champions/[slug]/page.tsx
│   ├── methodology/page.tsx
│   ├── status/page.tsx
│   ├── error.tsx
│   ├── globals.css
│   ├── layout.tsx
│   ├── loading.tsx
│   ├── not-found.tsx
│   └── page.tsx
├── components/
│   ├── ChampionGrid.tsx
│   ├── RoleSelector.tsx
│   ├── ScopeBar.tsx
│   ├── StatsTable.tsx
│   └── ViewTabs.tsx
├── lib/{api-errors,format,web-config}.ts
└── tests/
packages/public-api/
├── src/{contracts,queries,sort}.ts
└── package.json
e2e/champion-statistics.spec.ts
playwright.config.ts
```

---

### Task 1: Public Contracts, Read-Only Views, and Query Repository

**Files:**
- Create: `packages/public-api/package.json`
- Create: `packages/public-api/tsconfig.json`
- Create: `packages/public-api/src/contracts.ts`
- Create: `packages/public-api/src/sort.ts`
- Create: `packages/public-api/src/sort.test.ts`
- Create: `packages/public-api/src/queries.ts`
- Create: `packages/public-api/src/queries.integration.test.ts`
- Create: `packages/public-api/src/index.ts`
- Generate: `migrations/0001_public_views.sql`
- Modify: `apps/web/package.json`
- Create: `apps/web/lib/web-config.ts`
- Create: `apps/web/lib/web-config.test.ts`

**Interfaces:**
- Consumes: active publication and aggregate schema from the collector phase
- Produces: public response contracts, `createPublicQueries(database)`, stable sorting, and SQL views containing no private columns

- [ ] **Step 1: Define exact public contracts and failing sort tests**

```ts
export const statsViewSchema = z.enum(["items", "pairs", "trios", "boots"]);
export const statsSortSchema = z.enum(["adjusted", "winRate", "baselineDelta", "buildRate", "sample"]);
export type StatsView = z.infer<typeof statsViewSchema>;
export type StatsSort = z.infer<typeof statsSortSchema>;

export type PublicStatRow = {
  key: string;
  itemIds: number[];
  wins: number;
  losses: number;
  sample: number;
  rawWinRate: number;
  buildRate: number;
  baselineDelta: number;
  confidenceLower: number;
  confidenceUpper: number;
  adjustedScore: number | null;
  confidence: "recommended" | "low";
};
```

```ts
import { expect, it } from "vitest";
import { sortStats } from "./sort";

it("sorts recommended rows before low-confidence rows with stable ties", () => {
  const sorted = sortStats([
    statRow({ key: "2", adjustedScore: null, sample: 3 }),
    statRow({ key: "3", adjustedScore: 0.52, sample: 100 }),
    statRow({ key: "1", adjustedScore: 0.52, sample: 200 })
  ], "adjusted");
  expect(sorted.map((row) => row.key)).toEqual(["1", "3", "2"]);
});
```

- [ ] **Step 2: Run the sort test and verify the failure**

Run: `bunx vitest run packages/public-api/src/sort.test.ts`  
Expected: FAIL because `sortStats` does not exist.

- [ ] **Step 3: Implement stable sorting and response schemas**

```ts
const valueFor = (row: PublicStatRow, sort: StatsSort): number => {
  if (sort === "adjusted") return row.adjustedScore ?? Number.NEGATIVE_INFINITY;
  if (sort === "winRate") return row.rawWinRate;
  if (sort === "baselineDelta") return row.baselineDelta;
  if (sort === "buildRate") return row.buildRate;
  return row.sample;
};

export function sortStats(rows: readonly PublicStatRow[], sort: StatsSort): PublicStatRow[] {
  return [...rows].sort((left, right) =>
    valueFor(right, sort) - valueFor(left, sort) || right.sample - left.sample || left.key.localeCompare(right.key)
  );
}
```

Add Zod schemas for `PublicMeta`, `PublicChampionSummary`, `PublicChampion`, `PublicStatsResponse`, and `PublicMethodology`. `PublicStatsResponse` contains meta, champion, role, baseline, requested view/sort, minimum sample, and rows.

- [ ] **Step 4: Create public SQL views and the failing repository test**

The migration creates `public_active_publication`, `public_champions`, `public_item_metadata`, `public_champion_role_baselines`, `public_item_stats`, `public_combination_stats`, and `public_boots_stats`. Views expose publication/catalog/aggregate fields only. They do not join or select ladder snapshots, PUUID, matches, participant observations, raw final slots, or private run errors.

```ts
it("returns only the active publication and never exposes private identifiers", async () => {
  const queries = createPublicQueries(testDatabase);
  const response = await queries.stats({ championId: 222, role: "BOTTOM", view: "pairs", sort: "adjusted", includeLowConfidence: false });
  expect(response.rows.every((row) => row.sample >= response.minimumSample)).toBe(true);
  expect(JSON.stringify(response)).not.toMatch(/puuid|matchId|riotApiKey/i);
});
```

- [ ] **Step 5: Implement query repository and warming result**

```ts
export type PublicQueryError = { code: "dataset_warming" | "champion_not_found" | "role_not_found" };

export interface PublicQueries {
  meta(): Promise<PublicMeta | PublicQueryError>;
  champions(search?: string): Promise<PublicChampionSummary[]>;
  champion(championId: number): Promise<PublicChampion | PublicQueryError>;
  stats(input: { championId: number; role: Role; view: StatsView; sort: StatsSort; includeLowConfidence: boolean }): Promise<PublicStatsResponse | PublicQueryError>;
  methodology(): Promise<PublicMethodology>;
}
```

Queries always resolve the active publication first, constrain every aggregate query by that immutable ID, enforce `sample >= minimumSample` unless requested otherwise, and cap returned rows at 100. Search is case-insensitive, parameterized, and capped at 50 champions.

- [ ] **Step 6: Validate read-only configuration and repository**

`web-config.ts` accepts only `DATABASE_READ_URL` and `PUBLIC_SITE_URL`; it does not define `RIOT_API_KEY`.

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/public-api apps/web/lib/web-config.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/public-api apps/web/lib apps/web/package.json migrations bun.lock
git commit -m "feat: expose publication-scoped statistics queries"
```

---

### Task 2: HTTP API Routes, Error Semantics, and Caching

**Files:**
- Create: `apps/web/lib/api-errors.ts`
- Create: `apps/web/lib/http-cache.ts`
- Create: `apps/web/tests/api-routes.test.ts`
- Create: `apps/web/app/api/meta/route.ts`
- Create: `apps/web/app/api/champions/route.ts`
- Create: `apps/web/app/api/champions/[championId]/route.ts`
- Create: `apps/web/app/api/champions/[championId]/roles/[role]/stats/route.ts`
- Create: `apps/web/app/api/methodology/route.ts`

**Interfaces:**
- Consumes: `PublicQueries` and public Zod contracts from Task 1
- Produces: the five read-only endpoints specified by the design, structured `400/404/503`, ETags, and immutable-publication cache headers

- [ ] **Step 1: Write failing route tests**

```ts
it("returns dataset_warming as 503 with retry metadata", async () => {
  const response = await callMetaRoute(fakeQueries({ code: "dataset_warming" }));
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({ code: "dataset_warming", retryAfterSeconds: 300 });
});

it("rejects an invalid role and view", async () => {
  const response = await callStatsRoute({ championId: "222", role: "ADC", query: "view=timeline" });
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: "invalid_request" });
});
```

- [ ] **Step 2: Run route tests and verify the failure**

Run: `bunx vitest run apps/web/tests/api-routes.test.ts`  
Expected: FAIL because the routes and adapters do not exist.

- [ ] **Step 3: Implement shared route validation and errors**

```ts
export function errorResponse(error: PublicQueryError | { code: "invalid_request" }): Response {
  if (error.code === "dataset_warming") {
    return Response.json({ code: error.code, retryAfterSeconds: 300 }, { status: 503, headers: { "Retry-After": "300" } });
  }
  if (error.code === "champion_not_found" || error.code === "role_not_found") {
    return Response.json(error, { status: 404 });
  }
  return Response.json(error, { status: 400 });
}
```

Every route validates path and query inputs with Zod. The stats route defaults to `view=items`, `sort=adjusted`, and `includeLowConfidence=false`, but never defaults the role.

- [ ] **Step 4: Add publication cache behavior**

Successful responses set:

```ts
{
  "ETag": `"publication-${publicationId}-${resourceKey}"`,
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600"
}
```

If `If-None-Match` equals the generated ETag, return `304` with no body. `503` and `400` responses are `Cache-Control: no-store`.

- [ ] **Step 5: Verify endpoint matrix**

Add tests for champion search, unknown champion, unavailable role, default sort/view, inclusion of low-confidence rows, ETag `304`, bounded query parsing, and absence of private fields.

Run: `bunx vitest run apps/web/tests/api-routes.test.ts && bun run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api apps/web/lib apps/web/tests
git commit -m "feat: add cached read-only statistics API"
```

---

### Task 3: Champion Discovery and Explicit Role Flow

**Files:**
- Create: `apps/web/app/globals.css`
- Modify: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/components/ChampionGrid.tsx`
- Create: `apps/web/components/ChampionGrid.test.tsx`
- Create: `apps/web/app/champions/[slug]/page.tsx`
- Create: `apps/web/components/RoleSelector.tsx`
- Create: `apps/web/components/RoleSelector.test.tsx`
- Create: `apps/web/tests/setup.ts`
- Modify: `vitest.config.ts`
- Create: `apps/web/components/ScopeBar.tsx`
- Create: `apps/web/app/loading.tsx`
- Create: `apps/web/app/not-found.tsx`
- Create: `apps/web/app/error.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: `PublicQueries.champions`, `champion`, and `meta`
- Produces: searchable homepage, `/champions/{slug}`, explicit role links, fixed scope bar, and distinct loading/not-found/error states

- [ ] **Step 1: Add component test tooling**

Run: `bun add --cwd apps/web -d @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom`

Add a second inline project to `test.projects` in `vitest.config.ts` with `name: "web"`, `environment: "jsdom"`, `include: ["apps/web/**/*.test.ts", "apps/web/**/*.test.tsx"]`, and `setupFiles: ["apps/web/tests/setup.ts"]`; the setup file imports `@testing-library/jest-dom/vitest`.

- [ ] **Step 2: Write failing role-selector test**

```tsx
import { render, screen } from "@testing-library/react";
import { RoleSelector } from "./RoleSelector";

it("renders no selected role until the user chooses one", () => {
  render(<RoleSelector championSlug="jinx" roles={["BOTTOM", "UTILITY"]} selectedRole={null} />);
  expect(screen.getByRole("link", { name: "Bottom" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "Support" })).not.toHaveAttribute("aria-current");
  expect(screen.getByText("Choose a role to view statistics")).toBeVisible();
});
```

- [ ] **Step 3: Write failing champion-grid test**

```tsx
it("filters champions by localized name without changing the fixed scope", async () => {
  render(<ChampionGrid champions={[champion("Jinx"), champion("Ahri")]} />);
  await userEvent.type(screen.getByRole("searchbox", { name: "Search champions" }), "jin");
  expect(screen.getByRole("link", { name: /Jinx/ })).toBeVisible();
  expect(screen.queryByRole("link", { name: /Ahri/ })).toBeNull();
});
```

- [ ] **Step 4: Run component tests and verify failures**

Run: `bunx vitest run apps/web/components/RoleSelector.test.tsx apps/web/components/ChampionGrid.test.tsx`  
Expected: FAIL because the components do not exist.

- [ ] **Step 5: Implement server pages and focused client components**

```tsx
export function RoleSelector(props: { championSlug: string; roles: Role[]; selectedRole: Role | null }) {
  return <section aria-labelledby="role-heading">
    <h2 id="role-heading">Role</h2>
    {props.selectedRole === null && <p>Choose a role to view statistics</p>}
    <nav aria-label="Champion role">
      {props.roles.map((role) => <Link
        key={role}
        href={`/champions/${props.championSlug}?role=${role}`}
        aria-current={props.selectedRole === role ? "page" : undefined}
      >{roleLabel(role)}</Link>)}
    </nav>
  </section>;
}
```

The champion page parses `searchParams.role`; without it, it renders champion identity, `ScopeBar`, and `RoleSelector` only. An invalid or unavailable role renders a clear unavailable-role message and valid choices. It does not fall back to the most-played role.

- [ ] **Step 6: Implement responsive foundational styles and states**

Use semantic landmarks, visible focus, a minimum 44 px interactive target, a dark neutral palette with non-color confidence labels, and mobile-first CSS. Champion images include names as alt text; decorative item combinations later use one combined accessible label.

Run: `bunx vitest run apps/web/components && bun run typecheck`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web package.json bun.lock
git commit -m "feat: add champion discovery and explicit role selection"
```

---

### Task 4: Statistics Views, Sorting, and Confidence Presentation

**Files:**
- Create: `apps/web/lib/format.ts`
- Create: `apps/web/lib/format.test.ts`
- Create: `apps/web/components/ViewTabs.tsx`
- Create: `apps/web/components/StatsTable.tsx`
- Create: `apps/web/components/StatsTable.module.css`
- Create: `apps/web/components/StatsTable.test.tsx`
- Modify: `apps/web/app/champions/[slug]/page.tsx`

**Interfaces:**
- Consumes: `PublicStatsResponse` and URL search parameters `role`, `view`, `sort`, `lowConfidence`
- Produces: baseline summary, four statistics views, URL-addressable sorting, low-confidence control, confidence intervals, and responsive evidence rows

- [ ] **Step 1: Write failing formatter and table tests**

```ts
import { expect, it } from "vitest";
import { formatDelta, formatPercent } from "./format";

it("formats rates and signed percentage-point deltas", () => {
  expect(formatPercent(0.554)).toBe("55.4%");
  expect(formatDelta(0.04)).toBe("+4.0 pp");
  expect(formatDelta(-0.013)).toBe("−1.3 pp");
});
```

```tsx
it("shows evidence columns and labels a low-confidence row", () => {
  render(<StatsTable response={statsResponseWithRecommendedAndLowRows()} />);
  expect(screen.getByRole("columnheader", { name: "Win rate" })).toBeVisible();
  expect(screen.getByText("95% CI 45.2%–64.4%")).toBeVisible();
  expect(screen.getByText("Low confidence")).toBeVisible();
  expect(screen.getByText("100 games")).toBeVisible();
});
```

- [ ] **Step 2: Run tests and verify failures**

Run: `bunx vitest run apps/web/lib/format.test.ts apps/web/components/StatsTable.test.tsx`  
Expected: FAIL because formatters and table do not exist.

- [ ] **Step 3: Implement URL-addressable controls**

`ViewTabs` creates links preserving role while changing `view`. Sort headers preserve role/view/low-confidence and change `sort`. The low-confidence link toggles `lowConfidence=1`. Valid values are parsed by the same public contract schemas used by API routes.

```tsx
const views = [
  ["items", "Items"],
  ["pairs", "2-item builds"],
  ["trios", "3-item builds"],
  ["boots", "Boots"]
] as const;
```

- [ ] **Step 4: Implement the evidence table**

Each row renders Data Dragon item images/names, adjusted score or an em dash, raw win rate, baseline difference, build rate, sample, confidence interval, and a text confidence badge. Recommended rows come first under adjusted sorting. A low-confidence row never displays a recommendation score.

On viewports below 720 px, each row becomes a labeled evidence card; it must not require horizontal scrolling. The HTML retains a caption naming champion, role, patch, and view.

- [ ] **Step 5: Add baseline and limitation copy**

Above the table show champion-role baseline, eligible games, patch, coverage start, and publication age. Below it render this exact message:

```text
These results show correlation, not causation. Winning players earn more gold and are more likely to complete expensive items.
```

- [ ] **Step 6: Verify component and type behavior**

Add tests for each view label, every sort link, low-confidence default exclusion, item accessible names, negative delta formatting, empty results, and mobile CSS class application.

Run: `bunx vitest run apps/web && bun run typecheck`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: present transparent champion item statistics"
```

---

### Task 5: Methodology, Status, Legal Notice, and Dataset States

**Files:**
- Create: `apps/web/app/methodology/page.tsx`
- Create: `apps/web/app/status/page.tsx`
- Create: `apps/web/components/DatasetBanner.tsx`
- Create: `apps/web/components/DatasetBanner.test.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/champions/[slug]/page.tsx`
- Create: `apps/web/tests/content.test.tsx`

**Interfaces:**
- Consumes: public meta/methodology contracts
- Produces: warming and stale banners, methodology disclosure, public-safe data status, and required Riot footer notice

- [ ] **Step 1: Write failing dataset-banner tests**

```tsx
it.each([
  ["warming", "We’re collecting enough current-patch games"],
  ["stale", "Statistics were last updated"],
  ["fresh", ""]
] as const)("renders the %s state", (state, message) => {
  render(<DatasetBanner state={state} publishedAt="2026-08-01T10:00:00Z" />);
  if (message) expect(screen.getByText(new RegExp(message))).toBeVisible();
  else expect(screen.queryByRole("status")).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify the failure**

Run: `bunx vitest run apps/web/components/DatasetBanner.test.tsx`  
Expected: FAIL because `DatasetBanner` does not exist.

- [ ] **Step 3: Implement exact freshness semantics**

`fresh` means the active publication is at most six hours old. `stale` means it is older than six hours. `warming` means no active publication exists for the current TR realm patch. The browser receives a precomputed state from the server so client clocks do not alter rendering.

```ts
export function datasetState(meta: PublicMeta | PublicQueryError, now: Date): "fresh" | "stale" | "warming" {
  if ("code" in meta) return "warming";
  return now.getTime() - new Date(meta.publishedAt).getTime() > 6 * 60 * 60 * 1000 ? "stale" : "fresh";
}
```

- [ ] **Step 4: Implement methodology and status content**

Methodology covers TR1/420/Emerald+ scope, rank-at-collection semantics, 35-day coverage, exact patch filtering, role mapping, remake/duration rules, item classification/normalization, unordered contained multisets, formulas, 95% Wilson interval, sample threshold 100, survivor/gold-lead bias, and build-rate percentages not summing to 100.

Status shows patch, coverage start, last successful publication, age, public-safe collector stage/status, eligible-game counts by role, unknown-item count, and no identifiers or private error detail.

- [ ] **Step 5: Add required footer notice**

Render this visible footer text on every page:

```text
This product is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
```

- [ ] **Step 6: Verify copy and state behavior**

Tests assert the exact legal notice, every methodology topic, no Arena language presented as supported data, stale threshold boundary at exactly six hours, and absence of PUUID/match-history fields.

Run: `bunx vitest run apps/web/components/DatasetBanner.test.tsx apps/web/tests/content.test.tsx`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: explain dataset scope and freshness"
```

---

### Task 6: Browser Verification, Accessibility, and Deployment Safety

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/champion-statistics.spec.ts`
- Create: `e2e/dataset-states.spec.ts`
- Create: `apps/web/tests/seed-e2e.ts`
- Create: `apps/web/tests/security-boundary.test.ts`
- Create: `docs/operations/web.md`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: completed web application and a deterministic published fixture dataset
- Produces: `bun run test:e2e`, security-boundary checks, and web deployment documentation

- [ ] **Step 1: Install and configure Playwright**

Run: `bun add -d @playwright/test`

Add root scripts `"test:e2e": "playwright test"`, `"seed:e2e": "NODE_ENV=test bun apps/web/tests/seed-e2e.ts"`, and `"build": "bun --filter @lol/web build"`.

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: { command: "bun run dev", url: "http://127.0.0.1:3000", reuseExistingServer: !process.env.CI }
});
```

- [ ] **Step 2: Write the failing main browser flow**

```ts
import { expect, test } from "@playwright/test";

test("visitor chooses Jinx and a role before viewing pair statistics", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search champions" }).fill("Jinx");
  await page.getByRole("link", { name: /Jinx/ }).click();
  await expect(page.getByText("Choose a role to view statistics")).toBeVisible();
  await page.getByRole("link", { name: "Bottom" }).click();
  await page.getByRole("link", { name: "2-item builds" }).click();
  await expect(page.getByText("TR1 · Ranked Solo · Emerald+")).toBeVisible();
  await expect(page.getByRole("table", { name: /Jinx Bottom/ })).toBeVisible();
  await expect(page.getByText(/correlation, not causation/i)).toBeVisible();
});
```

- [ ] **Step 3: Run browser tests and verify the failure**

Run: `bunx playwright test e2e/champion-statistics.spec.ts`  
Expected: FAIL until the seeded web-test database and page wiring are complete.

- [ ] **Step 4: Add deterministic E2E seed and complete flows**

`apps/web/tests/seed-e2e.ts` creates one active publication with Jinx Bottom recommended and low-confidence rows. It refuses to run unless `NODE_ENV=test` and the database name ends in `_test`; otherwise it exits nonzero before connecting. Browser tests cover search, no default role, unavailable role, all four views, each sort, low-confidence toggle, warming, stale, `404`, keyboard focus order, and a 390 px viewport without horizontal overflow.

- [ ] **Step 5: Add a static security-boundary test**

```ts
it("keeps collector secrets and private database modules out of client components", async () => {
  const clientSources = await readClientComponentSources("apps/web");
  expect(clientSources).not.toMatch(/RIOT_API_KEY|X-Riot-Token|puuid|participantObservations|ladderSnapshots/);
});
```

The test also fails if `apps/web` imports `apps/collector`, if a file containing `"use client"` imports `@lol/database`, or if API fixture snapshots contain private identifiers.

- [ ] **Step 6: Document production web requirements**

The operations guide specifies `DATABASE_READ_URL`, `PUBLIC_SITE_URL`, HTTPS, the read-only database role/view grants, cache behavior, health checks, stale/warming semantics, deployment ordering after migrations, and the requirement for a separately scheduled collector. It explicitly states that a development or personal key cannot operate a public release.

- [ ] **Step 7: Run final verification**

```bash
bun run test
bun run typecheck
bun run test:e2e
bun run build
git diff --check
```

Expected: every command exits `0`; the production build contains no collector secret; main flows pass at desktop and 390 px mobile viewport.

- [ ] **Step 8: Commit**

```bash
git add playwright.config.ts e2e apps/web/tests docs/operations package.json bun.lock .gitignore
git commit -m "test: verify public statistics experience"
```

## Phase Acceptance Check

From a clean checkout with a fixture publication:

```bash
bun install --frozen-lockfile
docker compose up -d postgres
docker compose exec -T postgres createdb -U lol lol_stats_test
DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats_test bun run db:migrate
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats_test bun run seed:e2e
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats_test bun run test
bun run typecheck
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats_test bun run test:e2e
DATABASE_READ_URL=postgres://lol:lol@localhost:5432/lol_stats_test bun run build
```

Expected: all commands pass; Jinx opens without a selected role; selecting Bottom reveals publication-scoped statistics; low-confidence results are opt-in; warming/stale states are distinct; mobile content does not overflow; no public response or client artifact contains PUUIDs, Riot keys, or individual match data.
