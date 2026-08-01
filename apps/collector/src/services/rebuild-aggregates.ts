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

export type AggregateSink = {
  flushGroup?: (publicationId: string, group: AggregateGroup) => Promise<void> | void;
  replacePublication?: (publicationId: string, groups: Iterable<AggregateGroup>) => Promise<void> | void;
};

export type ObservationSource =
  | Iterable<AggregateObservation>
  | AsyncIterable<AggregateObservation>
  | ((cursor: unknown, pageSize: number) => Promise<{ rows: AggregateObservation[]; nextCursor?: unknown }>);

export type RebuildInput = {
  publicationId: string;
  source: ObservationSource;
  sink?: AggregateSink;
  pageSize?: number;
  catalog?: ReadonlyMap<number, { category?: string; normalizedBaseId?: number }>;
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

function emptyGroup(championId: number, role: string): AggregateGroup {
  return { championId, role, baseline: { wins: 0, losses: 0, sample: 0 }, items: new Map(), pairs: new Map(), trios: new Map(), boots: new Map() };
}
function keyOf(row: AggregateObservation): string { return `${row.championId}:${row.role}`; }
function validItem(item: AggregateItem, catalog?: RebuildInput["catalog"]): number | undefined {
  const id = typeof item === "number" ? item : Number(item.normalizedBaseId ?? item.itemId);
  const quantity = typeof item === "number" ? 1 : item.quantity ?? 1;
  if (!Number.isSafeInteger(id) || id < 0 || !Number.isSafeInteger(quantity) || quantity < 1) return undefined;
  const catalogItem = catalog?.get(id);
  if (typeof item !== "number" && item.category && item.category !== "CORE") return undefined;
  if (catalogItem && catalogItem.category && catalogItem.category !== "CORE") return undefined;
  if (catalog && !catalogItem) return undefined;
  return Number(catalogItem?.normalizedBaseId ?? id);
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
    const bootCatalog = catalog?.get(raw);
    const wrongCategory = typeof row.boots !== "number" && !!row.boots.category && row.boots.category !== "BOOTS";
    const bootId = Number(bootCatalog?.normalizedBaseId ?? raw);
    if (!wrongCategory && Number.isSafeInteger(bootId) && bootId >= 0 && (!catalog || (bootCatalog?.category === "BOOTS"))) {
      group.boots.set(bootId, addOutcome(group.boots.get(bootId), row.win));
    }
  }
}

async function* rowsFrom(source: ObservationSource, pageSize: number): AsyncGenerator<AggregateObservation> {
  if (typeof source === "function") {
    let cursor: unknown = undefined;
    while (true) {
      const page = await source(cursor, pageSize);
      for (const row of [...page.rows].sort(compareObservation)) yield row;
      if (page.nextCursor === undefined || page.rows.length === 0) break;
      cursor = page.nextCursor;
    }
  } else if (Symbol.asyncIterator in Object(source)) {
    for await (const row of source as AsyncIterable<AggregateObservation>) yield row;
  } else {
    for (const row of [...source as Iterable<AggregateObservation>].sort(compareObservation)) yield row;
  }
}

function compareObservation(a: AggregateObservation, b: AggregateObservation): number {
  return a.championId - b.championId || String(a.role).localeCompare(String(b.role)) || a.matchId.localeCompare(b.matchId) || a.participantId - b.participantId;
}

export async function rebuildAggregates(input: RebuildInput): Promise<RebuildResult> {
  const groups = new Map<string, AggregateGroup>();
  const pageSize = input.pageSize ?? 500;
  let currentKey: string | undefined;
  let current: AggregateGroup | undefined;
  for await (const row of rowsFrom(input.source, pageSize)) {
    const key = keyOf(row);
    if (currentKey !== undefined && key !== currentKey) {
      if (current && input.sink?.flushGroup && !input.sink.replacePublication) await input.sink.flushGroup(input.publicationId, current);
      current = undefined;
    }
    currentKey = key;
    current ??= groups.get(key) ?? emptyGroup(row.championId, row.role);
    groups.set(key, current);
    consume(current, row, input.catalog);
  }
  if (current && input.sink?.flushGroup && !input.sink.replacePublication) await input.sink.flushGroup(input.publicationId, current);
  if (input.sink?.replacePublication) await input.sink.replacePublication(input.publicationId, groups.values());
  const first = groups.values().next().value as AggregateGroup | undefined;
  return { publicationId: input.publicationId, groups, baseline: first?.baseline, items: first?.items, pairs: first?.pairs, trios: first?.trios, boots: first?.boots };
}
