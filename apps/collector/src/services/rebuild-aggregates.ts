import { combinationKey, combinations, type Role } from "@lol/domain";

export type Counter = { wins: number; losses: number; sample: number };
export function addOutcome(counter: Counter = { wins: 0, losses: 0, sample: 0 }, win: boolean): Counter {
  return { wins: counter.wins + Number(win), losses: counter.losses + Number(!win), sample: counter.sample + 1 };
}

export type AggregateItem = number | { itemId: number; quantity?: number; category?: string; normalizedBaseId?: number };
export type AggregateObservation = {
  championId: number;
  role: Role | string;
  matchId: string;
  participantId: number;
  win: boolean;
  items: readonly AggregateItem[];
  boots?: number | { itemId: number; category?: string; normalizedBaseId?: number } | null;
  patchId?: number;
  queueId?: number;
  platformId?: string;
  validationState?: string;
  gameCreation?: Date;
};

export type AggregateGroup = {
  championId: number;
  role: string;
  baseline: Counter;
  items: Map<number, Counter>;
  pairs: Map<string, Counter>;
  trios: Map<string, Counter>;
  boots: Map<number, Counter>;
};

export type AggregateOwner = { publicationId: string; runId: string; patchId: number };
export type AggregateSink = {
  preparePublication: (owner: AggregateOwner) => Promise<unknown> | unknown;
  flushGroup: (group: AggregateGroup) => Promise<unknown> | unknown;
};

export type ObservationSource =
  | Iterable<AggregateObservation>
  | AsyncIterable<AggregateObservation>
  | ((cursor: unknown, pageSize: number) => Promise<{ rows: AggregateObservation[]; nextCursor?: unknown }>);

export type RebuildInput = {
  publicationId: string;
  runId: string;
  patchId: number;
  source: ObservationSource;
  sink?: AggregateSink;
  pageSize?: number;
  catalog?: ReadonlyMap<number, { itemId?: number; category?: string; normalizedBaseId?: number }>;
  /** Collect all groups only for pure in-memory verification; production sinks stream groups. */
  collectResult?: boolean;
  coverageStartedAt?: Date;
};

export type RebuildResult = {
  publicationId: string;
  groups: Map<string, AggregateGroup>;
  /** Convenience fields for a single-group rebuild (kept for service callers). */
  baseline?: Counter;
  items?: Map<number, Counter>;
  pairs?: Map<string, Counter>;
  trios?: Map<string, Counter>;
  boots?: Map<number, Counter>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateAggregateOwner(input: RebuildInput): void {
  if (!UUID_PATTERN.test(input.publicationId) || !UUID_PATTERN.test(input.runId) || !Number.isSafeInteger(input.patchId) || input.patchId <= 0) {
    throw new Error("invalid aggregate owner");
  }
  if (input.sink && (typeof input.sink.preparePublication !== "function" || typeof input.sink.flushGroup !== "function")) {
    throw new Error("invalid aggregate sink");
  }
}

function emptyGroup(championId: number, role: string): AggregateGroup {
  return { championId, role, baseline: { wins: 0, losses: 0, sample: 0 }, items: new Map(), pairs: new Map(), trios: new Map(), boots: new Map() };
}
function keyOf(row: AggregateObservation): string { return `${row.championId}:${row.role}`; }
function validItem(item: AggregateItem, catalog?: RebuildInput["catalog"]): number | undefined {
  const rawId = typeof item === "number" ? item : Number(item.itemId);
  const id = typeof item === "number" ? item : Number(item.normalizedBaseId ?? item.itemId);
  const quantity = typeof item === "number" ? 1 : item.quantity ?? 1;
  if (!Number.isSafeInteger(id) || id < 0 || !Number.isSafeInteger(quantity) || quantity < 1) return undefined;
  const catalogItem = catalog?.get(rawId);
  if (typeof item !== "number" && item.category && item.category !== "CORE") return undefined;
  if (catalogItem && catalogItem.category && catalogItem.category !== "CORE") return undefined;
  if (catalog && !catalogItem) return undefined;
  const normalized = Number(catalogItem?.normalizedBaseId ?? id);
  if (catalog && ![...catalog.values()].some((entry) => Number(entry.normalizedBaseId ?? entry.itemId) === normalized && entry.category === "CORE")) return undefined;
  return normalized;
}

function consume(group: AggregateGroup, row: AggregateObservation, catalog?: RebuildInput["catalog"]): void {
  group.baseline = addOutcome(group.baseline, row.win);
  const multiset: number[] = [];
  const present = new Set<number>();
  for (const item of row.items ?? []) {
    const id = validItem(item, catalog);
    if (id === undefined) continue;
    const quantity = typeof item === "number" ? 1 : item.quantity ?? 1;
    for (let i = 0; i < quantity; i += 1) multiset.push(id);
    if (!present.has(id)) {
      present.add(id);
      const prior = group.items.get(id) ?? { wins: 0, losses: 0, sample: 0 };
      group.items.set(id, addOutcome(prior, row.win));
    }
  }
  for (const size of [2, 3] as const) {
    const target = size === 2 ? group.pairs : group.trios;
    for (const values of combinations(multiset, size)) {
      const key = combinationKey(values);
      target.set(key, addOutcome(target.get(key), row.win));
    }
  }
  if (row.boots !== undefined && row.boots !== null) {
    const raw = typeof row.boots === "number" ? row.boots : Number(row.boots.normalizedBaseId ?? row.boots.itemId);
    const bootCatalog = catalog?.get(typeof row.boots === "number" ? raw : row.boots.itemId);
    const wrongCategory = typeof row.boots !== "number" && !!row.boots.category && row.boots.category !== "BOOTS";
    const bootId = Number(bootCatalog?.normalizedBaseId ?? raw);
    const normalizedExists = !catalog || [...catalog.values()].some((entry) => Number(entry.normalizedBaseId ?? entry.itemId) === bootId && entry.category === "BOOTS");
    if (!wrongCategory && Number.isSafeInteger(bootId) && bootId >= 0 && normalizedExists && (!catalog || (bootCatalog?.category === "BOOTS"))) {
      group.boots.set(bootId, addOutcome(group.boots.get(bootId), row.win));
    }
  }
}

async function* rowsFrom(source: ObservationSource, pageSize: number): AsyncGenerator<AggregateObservation> {
  if (typeof source === "function") {
    let cursor: unknown = undefined;
    while (true) {
      const page = await source(cursor, pageSize);
      for (const row of page.rows) yield row;
      if (page.nextCursor === undefined || page.rows.length === 0) break;
      cursor = page.nextCursor;
    }
  } else if (Symbol.asyncIterator in Object(source)) {
    for await (const row of source as AsyncIterable<AggregateObservation>) yield row;
  } else {
    for (const row of source as Iterable<AggregateObservation>) yield row;
  }
}

function compareObservation(a: AggregateObservation, b: AggregateObservation): number {
  return a.championId - b.championId || String(a.role).localeCompare(String(b.role)) || a.matchId.localeCompare(b.matchId) || a.participantId - b.participantId;
}

export async function rebuildAggregates(input: RebuildInput): Promise<RebuildResult> {
  validateAggregateOwner(input);
  const groups = new Map<string, AggregateGroup>();
  // Sinks are owner-bound streaming writers; replacement is performed by preparePublication + flushGroup.
  const collectResult = input.collectResult ?? !input.sink;
  const pageSize = input.pageSize ?? 500;
  let currentKey: string | undefined;
  let current: AggregateGroup | undefined;
  const flushed = new Set<string>();
  let previous: AggregateObservation | undefined;
  if (input.sink) await input.sink.preparePublication({ publicationId: input.publicationId, runId: input.runId, patchId: input.patchId });
  for await (const row of rowsFrom(input.source, pageSize)) {
    if (input.coverageStartedAt && row.gameCreation && row.gameCreation.getTime() < input.coverageStartedAt.getTime()) continue;
    if (previous && compareObservation(row, previous) < 0) throw new Error("aggregate source order regression");
    previous = row;
    const key = keyOf(row);
    if (currentKey !== undefined && key !== currentKey) {
      if (current && input.sink?.flushGroup) await input.sink.flushGroup(current);
      flushed.add(currentKey);
      current = undefined;
    }
    if (flushed.has(key)) throw new Error("aggregate source group reappeared");
    currentKey = key;
    current ??= emptyGroup(row.championId, row.role);
    if (collectResult) groups.set(key, current);
    consume(current, row, input.catalog);
  }
  if (current && input.sink?.flushGroup) await input.sink.flushGroup(current);
  const first = groups.values().next().value as AggregateGroup | undefined;
  return { publicationId: input.publicationId, groups, baseline: first?.baseline, items: first?.items, pairs: first?.pairs, trios: first?.trios, boots: first?.boots };
}
