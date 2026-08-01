# LoL Match Collector and Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect current-patch TR1 Emerald+ Ranked Solo observations safely and publish reproducible item, pair, trio, and boots aggregates.

**Architecture:** A typed Riot boundary feeds a resumable, idempotent collection pipeline. Canonical match and participant rows are written transactionally; pure statistics functions build immutable aggregate publications that become public only after invariant checks pass.

**Tech Stack:** Bun, TypeScript, PostgreSQL 17, Drizzle ORM, Zod, Vitest, Pino

## Global Constraints

- Complete the foundation/catalog plan first.
- Platform is TR1; Match-V5 routing is EUROPE; queue is `420`.
- Eligible rank tiers are Emerald, Diamond, Master, Grandmaster, and Challenger at collection time.
- Accept only the active TR realm major/minor patch and games at least 300 seconds long.
- Reject early remake/surrender records and missing/invalid roles.
- Discovery uses a recorded 35-day start time and `count = 100` pagination.
- Do not log the Riot key, PUUID, authorization headers, or full Riot request URLs containing identifiers.
- Default recommendation sample is 100; default ranking is the 95% Wilson lower bound.
- Publication is atomic and failed runs cannot replace the active dataset.
- Use test-driven development and commit after every task.

## File Structure

```text
apps/collector/src/
├── cli.ts
├── logger.ts
├── pipeline.ts
└── commands/{collect,health}.ts
fixtures/riot/
├── league-emerald-page.json
├── league-master.json
├── match-ids-page.json
├── match-valid.json
└── match-remake.json
packages/
├── database/src/repositories/
│   ├── aggregates.ts
│   ├── catalog.ts
│   ├── collection-runs.ts
│   ├── ladder.ts
│   └── matches.ts
├── domain/src/
│   ├── combinations.ts
│   ├── eligibility.ts
│   ├── statistics.ts
│   └── tiers.ts
└── riot-client/src/
    ├── contracts/{league,match}.ts
    ├── http.ts
    ├── league.ts
    ├── match.ts
    ├── rate-limit.ts
    └── retry.ts
```

---

### Task 1: Riot HTTP Boundary, Retries, and Rate Limits

**Files:**
- Create: `packages/riot-client/package.json`
- Create: `packages/riot-client/tsconfig.json`
- Create: `packages/riot-client/src/errors.ts`
- Create: `packages/riot-client/src/retry.ts`
- Create: `packages/riot-client/src/rate-limit.ts`
- Create: `packages/riot-client/src/http.ts`
- Create: `packages/riot-client/src/http.test.ts`
- Create: `packages/riot-client/src/index.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: a server-side API key and injected `fetch`, clock, and sleep functions
- Produces: `RiotHttpClient.getJson<T>(request)`, `RiotHttpError`, and deterministic retry behavior

- [ ] **Step 1: Add logging dependency and write failing transport tests**

Run: `bun add pino`

```ts
import { describe, expect, it, vi } from "vitest";
import { RiotHttpClient } from "./http";

describe("RiotHttpClient", () => {
  it("uses the header key and never places it in the URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new RiotHttpClient({ apiKey: "RGAPI-secret", fetcher, sleep: vi.fn() });
    await client.getJson({ host: "tr1.api.riotgames.com", path: "/lol/test", schema: { parse: (value: unknown) => value } });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).not.toContain("RGAPI-secret");
    expect(new Headers(init.headers).get("X-Riot-Token")).toBe("RGAPI-secret");
  });

  it("honors Retry-After once after a 429", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep, random: () => 0 });
    await client.getJson({ host: "tr1.api.riotgames.com", path: "/lol/test", schema: { parse: (value: unknown) => value } });
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it.each([401, 403])("does not retry status %s", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep: vi.fn() });
    await expect(client.getJson({ host: "tr1.api.riotgames.com", path: "/lol/test", schema: { parse: (value: unknown) => value } })).rejects.toMatchObject({ status, retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests and verify the failure**

Run: `bunx vitest run packages/riot-client/src/http.test.ts`  
Expected: FAIL because `RiotHttpClient` does not exist.

- [ ] **Step 3: Implement typed request and error contracts**

```ts
export type Parser<T> = { parse(value: unknown): T };
export type RiotRequest<T> = { host: string; path: string; schema: Parser<T> };

export class RiotHttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly category: "auth" | "rate_limit" | "not_found" | "server" | "network" | "schema"
  ) { super(message); }
}
```

`RiotHttpClient` constructs `https://${host}${path}`, sends `X-Riot-Token`, and parses JSON through the supplied schema. It retries network errors and `5xx` at 250 ms, 500 ms, 1 s, 2 s, and 4 s plus up to 20% injected jitter. It honors numeric `Retry-After` for `429`, attempts at most five retries, treats `404` as nonretryable unavailable data, and treats `401`/`403` as nonretryable auth failure. It reads app/method rate headers into an in-memory bucket gate before the next request.

```ts
const retryableStatus = (status: number) => status === 429 || status >= 500;
const backoffMs = (attempt: number, random: () => number) =>
  Math.min(4_000, 250 * 2 ** attempt) * (1 + random() * 0.2);
```

- [ ] **Step 4: Verify retry, schema, and redaction behavior**

Add tests for a `500, 500, 200` sequence, malformed JSON, Zod rejection, capped retries, and an error message that contains endpoint category but contains neither the key nor path parameters.

Run: `bunx vitest run packages/riot-client/src/http.test.ts`  
Expected: PASS with fake timers and no real network calls.

- [ ] **Step 5: Commit**

```bash
git add packages/riot-client package.json bun.lock
git commit -m "feat: add resilient Riot HTTP client"
```

---

### Task 2: League-V4 and Match-V5 Typed Clients

**Files:**
- Create: `packages/riot-client/src/contracts/league.ts`
- Create: `packages/riot-client/src/contracts/match.ts`
- Create: `packages/riot-client/src/league.ts`
- Create: `packages/riot-client/src/league.test.ts`
- Create: `packages/riot-client/src/match.ts`
- Create: `packages/riot-client/src/match.test.ts`
- Create: `fixtures/riot/league-emerald-page.json`
- Create: `fixtures/riot/league-master.json`
- Create: `fixtures/riot/match-ids-page.json`
- Create: `fixtures/riot/match-valid.json`
- Create: `fixtures/riot/match-remake.json`
- Modify: `packages/riot-client/src/index.ts`

**Interfaces:**
- Consumes: `RiotHttpClient`
- Produces: `LeagueClient.listEligiblePlayers()`, `MatchClient.listMatchIds(input)`, `MatchClient.getMatch(matchId)`, and validated DTOs

- [ ] **Step 1: Create sanitized boundary fixtures and schemas**

League entries retain `puuid`, `queueType`, `tier`, `rank`, `leaguePoints`, `wins`, and `losses`. Match fixtures retain metadata match ID and participants plus info `platformId`, `queueId`, `gameVersion`, `gameCreation`, `gameDuration`; participants retain `participantId`, `puuid`, `championId`, `teamPosition`, `win`, `gameEndedInEarlySurrender`, and `item0` through `item6`.

```ts
export const leagueEntrySchema = z.object({
  puuid: z.string().min(1),
  queueType: z.literal("RANKED_SOLO_5x5"),
  tier: z.enum(["EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]),
  rank: z.string(),
  leaguePoints: z.number().int(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative()
});
```

- [ ] **Step 2: Write failing League client tests**

```ts
it("paginates Emerald and Diamond and includes each apex endpoint", async () => {
  const http = fakeRiotHttp([
    [emeraldPage], [], [], [], [], [], [], [], masterLeague, grandmasterLeague, challengerLeague
  ]);
  const players = await new LeagueClient(http).listEligiblePlayers();
  expect(players.map((player) => player.tier)).toEqual(expect.arrayContaining(["EMERALD", "MASTER", "GRANDMASTER", "CHALLENGER"]));
  expect(http.paths).toContain("/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=1");
  expect(http.paths).toContain("/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5");
});
```

The client requests Emerald and Diamond divisions `I`, `II`, `III`, `IV` until an empty page, then each apex endpoint once. It deduplicates PUUIDs and keeps the highest tier using `CHALLENGER > GRANDMASTER > MASTER > DIAMOND > EMERALD`.

- [ ] **Step 3: Write failing Match client tests**

```ts
it("builds a queue-420, 100-count, 35-day paginated match-list request", async () => {
  const http = fakeRiotHttp([["TR1_10", "TR1_9"]]);
  const client = new MatchClient(http);
  const ids = await client.listMatchIds({ puuid: "encrypted", startTime: 1_785_000_000, start: 100 });
  expect(ids).toEqual(["TR1_10", "TR1_9"]);
  expect(http.paths[0]).toBe("/lol/match/v5/matches/by-puuid/encrypted/ids?queue=420&startTime=1785000000&start=100&count=100");
  expect(http.hosts[0]).toBe("europe.api.riotgames.com");
});
```

- [ ] **Step 4: Run tests and verify failures**

Run: `bunx vitest run packages/riot-client/src/league.test.ts packages/riot-client/src/match.test.ts`  
Expected: FAIL because the typed clients do not exist.

- [ ] **Step 5: Implement typed service clients**

```ts
export class MatchClient {
  constructor(private readonly http: RiotHttpClient) {}

  listMatchIds(input: { puuid: string; startTime: number; start: number }): Promise<string[]> {
    const query = new URLSearchParams({ queue: "420", startTime: String(input.startTime), start: String(input.start), count: "100" });
    return this.http.getJson({
      host: "europe.api.riotgames.com",
      path: `/lol/match/v5/matches/by-puuid/${encodeURIComponent(input.puuid)}/ids?${query}`,
      schema: z.array(z.string())
    });
  }

  getMatch(matchId: string): Promise<MatchDto> {
    return this.http.getJson({
      host: "europe.api.riotgames.com",
      path: `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
      schema: matchSchema
    });
  }
}
```

- [ ] **Step 6: Verify fixture contracts and clients**

Run: `bunx vitest run packages/riot-client && bun run typecheck`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/riot-client fixtures/riot
git commit -m "feat: add League and Match API clients"
```

---

### Task 3: Ladder Snapshot and Match Discovery Checkpoints

**Files:**
- Create: `packages/database/src/repositories/collection-runs.ts`
- Create: `packages/database/src/repositories/ladder.ts`
- Create: `packages/database/src/repositories/matches.ts`
- Create: `packages/database/src/repositories/discovery.integration.test.ts`
- Create: `apps/collector/src/services/snapshot-ladder.ts`
- Create: `apps/collector/src/services/discover-matches.ts`
- Create: `apps/collector/src/services/discover-matches.test.ts`
- Modify: `packages/database/src/index.ts`

**Interfaces:**
- Consumes: `LeagueClient.listEligiblePlayers()` and `MatchClient.listMatchIds()`
- Produces: `snapshotLadder(context)`, `discoverMatches(context)`, resumable `CollectionRunRepository`, and unique match work rows

- [ ] **Step 1: Write the failing discovery service test**

```ts
it("paginates each PUUID, deduplicates IDs, and checkpoints the next offset", async () => {
  const matchClient = {
    listMatchIds: vi.fn()
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => `TR1_${index}`))
      .mockResolvedValueOnce(["TR1_100", "TR1_99"])
  };
  const repository = memoryDiscoveryRepository();
  await discoverMatches({ runId: "run-1", puuid: "private", coverageStart: new Date("2026-07-01T00:00:00Z"), matchClient, repository });
  expect(repository.uniqueMatchCount()).toBe(101);
  expect(repository.checkpointFor("private")).toBe(102);
});
```

- [ ] **Step 2: Run tests and verify the failure**

Run: `bunx vitest run apps/collector/src/services/discover-matches.test.ts`  
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement snapshot and discovery services**

```ts
export async function discoverMatches(input: DiscoverMatchesInput): Promise<void> {
  let start = await input.repository.loadOffset(input.runId, input.puuid);
  for (;;) {
    const ids = await input.matchClient.listMatchIds({
      puuid: input.puuid,
      startTime: Math.floor(input.coverageStart.getTime() / 1000),
      start
    });
    await input.repository.savePage(input.runId, input.puuid, start + ids.length, ids);
    start += ids.length;
    if (ids.length < 100) return;
  }
}
```

`snapshotLadder` creates one run-scoped row per PUUID in a transaction. `savePage` inserts match IDs with `onConflictDoNothing` and advances the PUUID offset in the same transaction. PUUIDs are accepted as method inputs but are absent from log context.

- [ ] **Step 4: Prove database idempotency**

The integration test snapshots the same ladder twice for one run, saves overlapping ID pages, and asserts one ladder row per PUUID, one match row per match ID, and the greatest committed offset.

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/discovery.integration.test.ts`  
Expected: PASS after repositories are implemented.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/repositories apps/collector/src/services
git commit -m "feat: checkpoint ladder and match discovery"
```

---

### Task 4: Match Eligibility and Participant Observation Parsing

**Files:**
- Create: `packages/domain/src/tiers.ts`
- Create: `packages/domain/src/eligibility.ts`
- Create: `packages/domain/src/eligibility.test.ts`
- Create: `apps/collector/src/services/ingest-match.ts`
- Create: `apps/collector/src/services/ingest-match.test.ts`
- Create: `packages/database/src/repositories/observations.ts`
- Create: `packages/database/src/repositories/observations.integration.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/database/src/index.ts`

**Interfaces:**
- Consumes: active patch, eligible PUUID lookup, classified catalog, and `MatchDto`
- Produces: `evaluateParticipant(input): EligibilityResult`, `parseFinalInventory(input)`, and transactional `ingestMatch(input)`

- [ ] **Step 1: Write the eligibility matrix test**

```ts
it.each([
  [{ platformId: "TR1", queueId: 420, gameVersion: "16.15.1", duration: 1800, eligible: true, role: "BOTTOM", remake: false }, true],
  [{ platformId: "EUW1", queueId: 420, gameVersion: "16.15.1", duration: 1800, eligible: true, role: "BOTTOM", remake: false }, false],
  [{ platformId: "TR1", queueId: 440, gameVersion: "16.15.1", duration: 1800, eligible: true, role: "BOTTOM", remake: false }, false],
  [{ platformId: "TR1", queueId: 420, gameVersion: "16.14.1", duration: 1800, eligible: true, role: "BOTTOM", remake: false }, false],
  [{ platformId: "TR1", queueId: 420, gameVersion: "16.15.1", duration: 299, eligible: true, role: "BOTTOM", remake: false }, false],
  [{ platformId: "TR1", queueId: 420, gameVersion: "16.15.1", duration: 1800, eligible: false, role: "BOTTOM", remake: false }, false],
  [{ platformId: "TR1", queueId: 420, gameVersion: "16.15.1", duration: 1800, eligible: true, role: "", remake: false }, false],
  [{ platformId: "TR1", queueId: 420, gameVersion: "16.15.1", duration: 1800, eligible: true, role: "BOTTOM", remake: true }, false]
])("applies every scope rule", (input, accepted) => {
  expect(evaluateParticipant({ ...input, activePatch: "16.15" }).accepted).toBe(accepted);
});
```

- [ ] **Step 2: Run the test and verify the failure**

Run: `bunx vitest run packages/domain/src/eligibility.test.ts`  
Expected: FAIL because `evaluateParticipant` does not exist.

- [ ] **Step 3: Implement explicit rejection results**

```ts
export type RejectionReason = "platform" | "queue" | "patch" | "rank" | "role" | "remake" | "duration" | "required_field";
export type EligibilityResult = { accepted: true; role: Role } | { accepted: false; reason: RejectionReason };

export function evaluateParticipant(input: EligibilityInput): EligibilityResult {
  if (input.platformId !== "TR1") return { accepted: false, reason: "platform" };
  if (input.queueId !== 420) return { accepted: false, reason: "queue" };
  if (toPatchKey(input.gameVersion) !== input.activePatch) return { accepted: false, reason: "patch" };
  if (!input.eligible) return { accepted: false, reason: "rank" };
  const role = parseTeamPosition(input.role);
  if (!role) return { accepted: false, reason: "role" };
  if (input.remake) return { accepted: false, reason: "remake" };
  if (input.duration < 300) return { accepted: false, reason: "duration" };
  return { accepted: true, role };
}
```

- [ ] **Step 4: Write the failing ingestion test**

The service test supplies `match-valid.json`, an eligible set containing only 8 of its 10 PUUIDs, and a catalog containing core, boots, and excluded IDs. Assert exactly 8 observations, normalized core multisets, separate upgraded boots, rejection counters for the two ineligible players, and no PUUID in logger arguments.

Run: `bunx vitest run apps/collector/src/services/ingest-match.test.ts`  
Expected: FAIL because `ingestMatch` does not exist.

- [ ] **Step 5: Implement transactional ingestion**

```ts
export async function ingestMatch(input: IngestMatchInput): Promise<IngestMatchResult> {
  const remake = input.match.info.participants.some((participant) => participant.gameEndedInEarlySurrender);
  const parsed = input.match.info.participants.map((participant) =>
    parseParticipant({ participant, info: input.match.info, remake, eligiblePlayer: input.eligiblePlayers.get(participant.puuid), catalog: input.catalog })
  );
  return input.observations.saveValidatedMatch(input.runId, input.patchId, input.match, parsed);
}
```

`saveValidatedMatch` writes match validation plus eligible observations, normalized core-item slot rows, and zero/one boots row in one transaction. Replaying the same match uses conflict-safe equality checks; differing canonical values mark the run failed rather than silently overwriting data.

- [ ] **Step 6: Verify participant persistence**

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/domain/src/eligibility.test.ts apps/collector/src/services/ingest-match.test.ts packages/database/src/repositories/observations.integration.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain packages/database/src/repositories apps/collector/src/services
git commit -m "feat: ingest eligible participant observations"
```

---

### Task 5: Canonical Combinations and Confidence Statistics

**Files:**
- Create: `packages/domain/src/combinations.ts`
- Create: `packages/domain/src/combinations.test.ts`
- Create: `packages/domain/src/statistics.ts`
- Create: `packages/domain/src/statistics.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: normalized core-item multisets and `{ wins, sample, baselineWins, baselineSample }`
- Produces: `combinationKey(items)`, `combinations(items, size)`, `wilson95(wins, sample)`, and `calculateAggregateMetrics(input)`

- [ ] **Step 1: Write failing multiset tests**

```ts
import { describe, expect, it } from "vitest";
import { combinationKey, combinations } from "./combinations";

describe("combinations", () => {
  it("sorts unordered keys, preserves duplicates, and deduplicates equal subsets", () => {
    expect(combinationKey([3031, 6672])).toBe("3031:6672");
    expect(combinationKey([6672, 3031])).toBe("3031:6672");
    expect(combinations([3031, 3031, 6672], 2)).toEqual([[3031, 3031], [3031, 6672]]);
  });

  it("returns every contained trio from four items", () => {
    expect(combinations([1, 2, 3, 4], 3)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Write failing statistic tests**

```ts
import { expect, it } from "vitest";
import { calculateAggregateMetrics, wilson95 } from "./statistics";

it("calculates transparent metrics and ranks by the Wilson lower bound", () => {
  expect(wilson95(55, 100)).toEqual({ lower: expect.closeTo(0.4524, 4), upper: expect.closeTo(0.6439, 4) });
  expect(calculateAggregateMetrics({ wins: 55, sample: 100, baselineWins: 510, baselineSample: 1000 })).toMatchObject({
    losses: 45,
    rawWinRate: 0.55,
    buildRate: 0.1,
    baselineWinRate: 0.51,
    baselineDelta: 0.04,
    recommended: true
  });
});

it("does not rank a sample below 100", () => {
  expect(calculateAggregateMetrics({ wins: 99, sample: 99, baselineWins: 510, baselineSample: 1000 }).recommended).toBe(false);
});
```

- [ ] **Step 3: Run tests and verify failures**

Run: `bunx vitest run packages/domain/src/combinations.test.ts packages/domain/src/statistics.test.ts`  
Expected: FAIL because these modules do not exist.

- [ ] **Step 4: Implement combinations and Wilson metrics**

```ts
export function combinationKey(items: readonly number[]): string {
  return [...items].sort((a, b) => a - b).join(":");
}

export function wilson95(wins: number, sample: number): { lower: number; upper: number } {
  if (sample === 0) return { lower: 0, upper: 0 };
  const z = 1.959963984540054;
  const p = wins / sample;
  const denominator = 1 + z * z / sample;
  const center = (p + z * z / (2 * sample)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * sample)) / sample) / denominator;
  return { lower: center - margin, upper: center + margin };
}
```

`combinations` generates index combinations, sorts each multiset, stores by `combinationKey` in a map, and returns unique multisets sorted by key. `calculateAggregateMetrics` validates `0 <= wins <= sample <= baselineSample`, uses minimum sample 100 by default, and returns every field named in its tests plus `adjustedScore = interval.lower`.

- [ ] **Step 5: Verify edge cases**

Add tests for zero samples, all wins, all losses, duplicate items, fewer items than requested size, invalid counts, and stable output ordering.

Run: `bunx vitest run packages/domain && bun run typecheck`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain
git commit -m "feat: calculate item combination confidence metrics"
```

---

### Task 6: Aggregate Rebuild, Invariants, and Atomic Publication

**Files:**
- Create: `packages/database/src/repositories/aggregates.ts`
- Create: `packages/database/src/repositories/aggregates.integration.test.ts`
- Create: `apps/collector/src/services/rebuild-aggregates.ts`
- Create: `apps/collector/src/services/rebuild-aggregates.test.ts`
- Create: `apps/collector/src/services/publish.ts`
- Create: `apps/collector/src/services/publish.integration.test.ts`
- Modify: `packages/database/src/index.ts`

**Interfaces:**
- Consumes: canonical observations and pure domain statistics
- Produces: `rebuildAggregates(input)`, `verifyPublication(input)`, and `publishAtomically(input)`

- [ ] **Step 1: Write the failing aggregate service test**

```ts
it("builds baseline, item, pair, trio, and boots counters from observations", async () => {
  const source = fixtureObservations([
    { win: true, items: [3031, 6672, 3085], boots: 3006 },
    { win: false, items: [6672, 3031], boots: 3006 }
  ]);
  const result = await rebuildAggregates({ publicationId: "pub-1", source, sink: memoryAggregateSink() });
  expect(result.baseline).toEqual({ wins: 1, losses: 1, sample: 2 });
  expect(result.pairs.get("3031:6672")).toEqual({ wins: 1, losses: 1, sample: 2 });
  expect(result.trios.get("3031:3085:6672")).toEqual({ wins: 1, losses: 0, sample: 1 });
  expect(result.boots.get(3006)).toEqual({ wins: 1, losses: 1, sample: 2 });
});
```

- [ ] **Step 2: Run the test and verify the failure**

Run: `bunx vitest run apps/collector/src/services/rebuild-aggregates.test.ts`  
Expected: FAIL because the aggregate service does not exist.

- [ ] **Step 3: Implement streaming aggregation**

Process observations in bounded database pages. For each champion-role key, count baseline outcomes, count each distinct normalized core item once, generate unique pairs/trios with `combinations`, and count boots separately. Flush upserts for one champion-role at a time so the worker does not hold the entire patch in memory.

```ts
export type Counter = { wins: number; losses: number; sample: number };
export function addOutcome(counter: Counter, win: boolean): Counter {
  return { wins: counter.wins + Number(win), losses: counter.losses + Number(!win), sample: counter.sample + 1 };
}
```

- [ ] **Step 4: Write failing publication invariant tests**

The tests create an inactive publication and prove each violation blocks activation: `wins + losses !== sample`, aggregate sample above baseline, unknown item, observation from queue `440`, duplicate participant, and recomputation mismatch. A valid publication must deactivate the previous row and activate the new row inside one serializable transaction.

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run apps/collector/src/services/publish.integration.test.ts`  
Expected: FAIL before `verifyPublication` and `publishAtomically` exist.

- [ ] **Step 5: Implement invariant reports and atomic activation**

```ts
export type InvariantFailure = { code: string; count: number };
export type VerificationReport = { valid: boolean; failures: InvariantFailure[] };

export async function publishAtomically(input: PublishInput): Promise<void> {
  const report = await verifyPublication(input);
  if (!report.valid) throw new PublicationInvariantError(report.failures);
  await input.database.transaction(async (transaction) => {
    await input.repository.deactivateCurrent(transaction);
    await input.repository.activate(transaction, input.publicationId);
    await input.repository.markRunPublished(transaction, input.runId, input.publicationId);
  }, { isolationLevel: "serializable" });
}
```

- [ ] **Step 6: Verify rebuild determinism and atomicity**

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/repositories/aggregates.integration.test.ts apps/collector/src/services/rebuild-aggregates.test.ts apps/collector/src/services/publish.integration.test.ts`  
Expected: PASS; running the rebuild twice yields byte-equivalent sorted aggregate rows.

- [ ] **Step 7: Commit**

```bash
git add packages/database/src/repositories apps/collector/src/services
git commit -m "feat: publish verified item statistics atomically"
```

---

### Task 7: Resumable Collector CLI and Public-Safe Health

**Files:**
- Create: `apps/collector/src/logger.ts`
- Create: `apps/collector/src/pipeline.ts`
- Create: `apps/collector/src/pipeline.integration.test.ts`
- Create: `apps/collector/src/commands/collect.ts`
- Create: `apps/collector/src/commands/health.ts`
- Create: `apps/collector/src/cli.ts`
- Modify: `apps/collector/package.json`
- Modify: `package.json`
- Create: `docs/operations/collector.md`

**Interfaces:**
- Consumes: all collector services and repositories from Tasks 1–6
- Produces: `runCollection(dependencies)`, `bun run collect`, `bun run collector:health`, documented cron/scheduler exit behavior

- [ ] **Step 1: Write the failing pipeline restart test**

```ts
it("resumes after a fetch-stage crash and publishes exactly once", async () => {
  const harness = pipelineHarness({ failAfterFetchedMatches: 2 });
  await expect(runCollection(harness.dependencies)).rejects.toThrow("injected fetch failure");
  expect(harness.activePublication()).toBeNull();
  await runCollection(harness.withoutFailure());
  expect(harness.fetchCountFor("TR1_1")).toBe(1);
  expect(harness.publicationCount()).toBe(1);
  expect(harness.activePublication()?.status).toBe("ACTIVE");
});
```

- [ ] **Step 2: Run the test and verify the failure**

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run apps/collector/src/pipeline.integration.test.ts`  
Expected: FAIL because `runCollection` does not exist.

- [ ] **Step 3: Implement the explicit stage machine**

```ts
export const COLLECTION_STAGES = [
  "CATALOG",
  "LADDER",
  "DISCOVERY",
  "MATCHES",
  "AGGREGATES",
  "VERIFY",
  "PUBLISH"
] as const;

export async function runCollection(dependencies: PipelineDependencies): Promise<string> {
  const run = await dependencies.runs.resumeOrCreate({ coverageDays: 35, minimumSample: 100 });
  for (const stage of COLLECTION_STAGES) {
    if (await dependencies.runs.isStageComplete(run.id, stage)) continue;
    await dependencies.stageHandlers[stage](run);
    await dependencies.runs.completeStage(run.id, stage);
  }
  return run.id;
}
```

Any thrown error marks the run `FAILED` with a public-safe category and private structured detail. Auth failures exit with code `2`; invariant failures with `3`; exhausted transient failures with `4`; success with `0`. A later run resumes a failed run only when patch and coverage parameters match.

- [ ] **Step 4: Implement secret-safe structured logging**

Create a Pino logger with redaction paths for `riotApiKey`, `puuid`, `headers.X-Riot-Token`, and request path. Tests serialize representative events and assert those raw values are absent. Allowed log fields are run ID, stage, endpoint category, host, response status, attempt, duration, and aggregate counts.

- [ ] **Step 5: Add CLI commands and operations documentation**

```json
{
  "scripts": {
    "collect": "bun --filter @lol/collector collect",
    "collector:health": "bun --filter @lol/collector health"
  }
}
```

`collect` loads environment config, migrates only when explicitly passed `--migrate`, runs the stage machine, and closes the database. `health --json` prints patch, run status, stage, data age, counters, unknown item count, and public-safe error category. The operations guide documents environment variables, development-key expiry behavior, exit codes, safe restart, an hourly recommended production schedule, scheduler overlap prevention with a PostgreSQL advisory lock, and production-key requirements.

- [ ] **Step 6: Run the full collector verification**

Run: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bun run test`  
Expected: PASS with no live Riot calls.

Run: `bun run typecheck && bun run collector:health --json && git diff --check`  
Expected: typecheck and diff checks pass; health returns valid JSON and no secrets.

- [ ] **Step 7: Commit**

```bash
git add apps/collector packages docs/operations package.json bun.lock
git commit -m "feat: orchestrate resumable statistics collection"
```

## Phase Acceptance Check

Run from a clean checkout with sanitized fixtures and no Riot key:

```bash
bun install --frozen-lockfile
docker compose up -d postgres
bun run db:migrate
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bun run test
bun run typecheck
```

Expected: all offline tests pass, a fixture pipeline publishes one deterministic aggregate dataset, restart recovery is proven, and logs contain neither fixture PUUIDs nor secrets.

For the first authorized live prototype run, export `RIOT_API_KEY` outside the repository and run:

```bash
bun run collect
bun run collector:health --json
```

Expected: collection either publishes a valid current-patch dataset or exits with a documented actionable status without exposing partial aggregates.
