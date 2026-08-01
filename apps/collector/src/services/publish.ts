import { rebuildAggregates, type AggregateObservation } from "./rebuild-aggregates";

export type InvariantFailure = { code: string; count: number };
export type VerificationReport = { valid: boolean; failures: InvariantFailure[] };
export class PublicationInvariantError extends Error {
  readonly failures: InvariantFailure[];
  constructor(failures: InvariantFailure[]) { super("publication invariants failed"); this.name = "PublicationInvariantError"; this.failures = failures; }
}

/** Internal canonical state loaded under transaction locks. Not an input accepted by publishAtomically. */
export type PublishSnapshot = {
  publicationId: string;
  runId: string;
  patchId: number;
  publication?: { id: string; patchId: number; runId: string; isActive: boolean };
  patch?: { id: number; isActive: boolean; patchKey?: string };
  run?: { id: string; status: string; publicationId?: string | null; stage?: string };
  baseline?: any[];
  items?: any[];
  combinations?: any[];
  boots?: any[];
  observations?: AggregateObservation[];
  itemCatalog?: ReadonlyMap<number, { itemId?: number; category?: string; normalizedBaseId?: number }>;
};

export type CanonicalPublishInput = {
  publicationId: string;
  runId: string;
  database: { transaction?: (fn: (tx: any) => Promise<unknown>, options?: { isolationLevel: "serializable" }) => Promise<unknown> };
  repository: CanonicalPublishRepository;
};

export type CanonicalPublishRepository = {
  lockAndLoad: (tx: any, publicationId: string, runId: string) => Promise<PublishSnapshot>;
  activateVerified: (tx: any, publicationId: string, runId: string) => Promise<unknown>;
};

function countFailure(map: Map<string, number>, code: string, count = 1) { if (count > 0) map.set(code, (map.get(code) ?? 0) + count); }
function equation(row: any): boolean { return Number.isSafeInteger(Number(row.wins)) && Number.isSafeInteger(Number(row.losses)) && Number.isSafeInteger(Number(row.sample)) && Number(row.wins) >= 0 && Number(row.losses) >= 0 && Number(row.sample) >= 0 && Number(row.wins) + Number(row.losses) === Number(row.sample); }
function itemCatalogEntry(catalog: ReadonlyMap<number, any> | undefined, id: number): any {
  if (!catalog) return undefined;
  return catalog.get(id) ?? [...catalog.values()].find((entry) => Number(entry.normalizedBaseId ?? entry.itemId) === id);
}
function canonicalCombination(key: unknown, size: unknown): number[] | undefined {
  if (typeof key !== "string" || !/^(0|[1-9][0-9]*)(:(0|[1-9][0-9]*))*$/.test(key)) return undefined;
  const ids = key.split(":").map(Number);
  if (!Number.isInteger(size) || (size !== 2 && size !== 3) || ids.length !== size || ids.some((id) => !Number.isSafeInteger(id) || id < 0)) return undefined;
  for (let i = 1; i < ids.length; i += 1) if (ids[i] < ids[i - 1]) return undefined;
  return ids;
}

/** Pure verifier for tests and diagnostics. Production publication always uses canonical DB state. */
export async function verifyPublicationSnapshot(input: PublishSnapshot): Promise<VerificationReport> {
  const failures = new Map<string, number>();
  const aggregates = { baseline: input.baseline ?? [], items: input.items ?? [], combinations: input.combinations ?? [], boots: input.boots ?? [] };
  const observations = input.observations ?? [];
  const catalog = input.itemCatalog;
  if (!input.publication || input.publication.id !== input.publicationId || input.publication.patchId !== input.patchId || input.publication.runId !== input.runId || input.publication.isActive) countFailure(failures, "PUBLICATION_NOT_ELIGIBLE");
  if (!input.patch || input.patch.id !== input.patchId || !input.patch.isActive) countFailure(failures, "PATCH_NOT_CURRENT");
  if (!input.run || input.run.id !== input.runId || input.run.status !== "RUNNING" || (input.run.stage !== undefined && input.run.stage !== "publish") || (input.run.publicationId && input.run.publicationId !== input.publicationId)) countFailure(failures, "RUN_NOT_ELIGIBLE");
  if (!catalog) countFailure(failures, "CATALOG_MISSING");

  const baselineByGroup = new Map<string, any>();
  const duplicateAgg = new Set<string>();
  for (const row of aggregates.baseline) {
    const key = `${row.championId}:${row.role}`;
    if (duplicateAgg.has(`b:${key}`)) countFailure(failures, "DUPLICATE_AGGREGATE_ROW");
    duplicateAgg.add(`b:${key}`);
    if (!equation(row)) countFailure(failures, "COUNT_EQUATION");
    baselineByGroup.set(key, row);
  }
  const allAgg = [
    ...aggregates.items.map((row) => ({ ...row, __kind: "item" })),
    ...aggregates.combinations.map((row) => ({ ...row, __kind: "combination" })),
    ...aggregates.boots.map((row) => ({ ...row, __kind: "boots" }))
  ];
  const seenAggregate = new Set<string>();
  const missingBaseline = new Set<string>();
  for (const row of allAgg) {
    const group = `${row.championId}:${row.role}`;
    const key = `${row.__kind}:${group}:${row.itemId ?? `${row.size}:${row.combinationKey}`}`;
    if (seenAggregate.has(key)) countFailure(failures, "DUPLICATE_AGGREGATE_ROW");
    seenAggregate.add(key);
    if (!equation(row)) countFailure(failures, "COUNT_EQUATION");
    const base = baselineByGroup.get(group);
    if (!base) missingBaseline.add(group);
    else if (Number(row.sample) > Number(base.sample)) countFailure(failures, "AGGREGATE_SAMPLE_ABOVE_BASELINE");
  }
  const identities = new Set<string>();
  const observationGroups = new Set<string>();
  for (const row of observations) {
    const identity = `${row.matchId}:${row.participantId}`;
    if (identities.has(identity)) countFailure(failures, "DUPLICATE_PARTICIPANT_IDENTITY");
    identities.add(identity);
    observationGroups.add(`${row.championId}:${row.role}`);
    if (row.patchId !== input.patchId || row.queueId !== 420 || row.platformId !== "TR1" || row.validationState !== "VALID" || !row.matchId || !Number.isSafeInteger(row.participantId)) countFailure(failures, "INVALID_OBSERVATION");
    if (typeof row.win !== "boolean" || typeof row.championId !== "number" || typeof row.role !== "string") countFailure(failures, "INVALID_OBSERVATION");
    for (const raw of row.items ?? []) {
      const rawId = typeof raw === "number" ? raw : raw.itemId;
      const entry = itemCatalogEntry(catalog, Number(rawId));
      if (!entry) countFailure(failures, "UNKNOWN_ITEM");
      else if (entry.category !== "CORE" || typeof raw !== "number" && raw.category && raw.category !== "CORE") countFailure(failures, "WRONG_CATEGORY_ITEM");
    }
    if (row.boots !== undefined && row.boots !== null) {
      const rawId = typeof row.boots === "number" ? row.boots : row.boots.itemId;
      const entry = itemCatalogEntry(catalog, Number(rawId));
      if (!entry) countFailure(failures, "UNKNOWN_ITEM");
      else if (entry.category !== "BOOTS" || typeof row.boots !== "number" && row.boots.category && row.boots.category !== "BOOTS") countFailure(failures, "WRONG_CATEGORY_ITEM");
    }
  }
  for (const group of observationGroups) if (!baselineByGroup.has(group)) missingBaseline.add(group);
  countFailure(failures, "MISSING_BASELINE", missingBaseline.size);
  for (const row of aggregates.items) {
    const entry = itemCatalogEntry(catalog, Number(row.itemId));
    if (!entry) countFailure(failures, "UNKNOWN_ITEM"); else if (entry.category !== "CORE") countFailure(failures, "WRONG_CATEGORY_ITEM");
  }
  for (const row of aggregates.boots) {
    const entry = itemCatalogEntry(catalog, Number(row.itemId));
    if (!entry) countFailure(failures, "UNKNOWN_ITEM"); else if (entry.category !== "BOOTS") countFailure(failures, "WRONG_CATEGORY_ITEM");
  }
  for (const row of aggregates.combinations) {
    const ids = canonicalCombination(row.combinationKey, row.size);
    if (!ids) countFailure(failures, "MALFORMED_COMBINATION");
    else for (const id of ids) {
      const entry = itemCatalogEntry(catalog, id);
      if (!entry) countFailure(failures, "UNKNOWN_ITEM"); else if (entry.category !== "CORE") countFailure(failures, "WRONG_CATEGORY_ITEM");
    }
  }
  const acceptedObservations = observations.filter((row) => row.patchId === input.patchId && row.queueId === 420 && row.platformId === "TR1" && row.validationState === "VALID");
  const recomputed = await rebuildAggregates({ publicationId: input.publicationId, source: acceptedObservations, catalog: catalog as any });
  const expected = [...recomputed.groups.values()].flatMap((group) => [
    { kind: "baseline", championId: group.championId, role: group.role, ...group.baseline },
    ...[...group.items].map(([itemId, c]) => ({ kind: "item", championId: group.championId, role: group.role, itemId, ...c })),
    ...[...group.pairs].map(([combinationKey, c]) => ({ kind: "combination", championId: group.championId, role: group.role, size: 2, combinationKey, ...c })),
    ...[...group.trios].map(([combinationKey, c]) => ({ kind: "combination", championId: group.championId, role: group.role, size: 3, combinationKey, ...c })),
    ...[...group.boots].map(([itemId, c]) => ({ kind: "boots", championId: group.championId, role: group.role, itemId, ...c }))
  ]);
  const actual = [
    ...aggregates.baseline.map((r) => ({ kind: "baseline", championId: r.championId, role: r.role, wins: r.wins, losses: r.losses, sample: r.sample })),
    ...aggregates.items.map((r) => ({ kind: "item", championId: r.championId, role: r.role, itemId: r.itemId, wins: r.wins, losses: r.losses, sample: r.sample })),
    ...aggregates.combinations.map((r) => ({ kind: "combination", championId: r.championId, role: r.role, size: r.size, combinationKey: r.combinationKey, wins: r.wins, losses: r.losses, sample: r.sample })),
    ...aggregates.boots.map((r) => ({ kind: "boots", championId: r.championId, role: r.role, itemId: r.itemId, wins: r.wins, losses: r.losses, sample: r.sample }))
  ];
  if (JSON.stringify(expected.map((r) => JSON.stringify(r)).sort()) !== JSON.stringify(actual.map((r) => JSON.stringify(r)).sort())) countFailure(failures, "RECOMPUTATION_MISMATCH");
  return { valid: failures.size === 0, failures: [...failures].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })) };
}

/** Loads and verifies canonical rows inside a caller-owned transaction. */
export async function verifyPublication(input: CanonicalPublishInput): Promise<VerificationReport> {
  rejectSnapshotFields(input);
  if (!input.database?.transaction) throw new Error("database transaction is required");
  return input.database.transaction(async (tx) => verifyPublicationInTransaction(input, tx), { isolationLevel: "serializable" }) as Promise<VerificationReport>;
}

async function verifyPublicationInTransaction(input: CanonicalPublishInput, tx: any): Promise<VerificationReport> {
  const snapshot = await input.repository.lockAndLoad(tx, input.publicationId, input.runId);
  return verifyPublicationSnapshot(snapshot);
}

export async function publishAtomically(input: CanonicalPublishInput): Promise<void> {
  rejectSnapshotFields(input);
  if (!input.database?.transaction) throw new Error("database transaction is required");
  await input.database.transaction(async (tx) => {
    const report = await verifyPublicationInTransaction(input, tx);
    if (!report.valid) throw new PublicationInvariantError(report.failures);
    const changed = await input.repository.activateVerified(tx, input.publicationId, input.runId);
    if (changed === false) throw new Error("publication activation changed no rows");
  }, { isolationLevel: "serializable" });
}

function rejectSnapshotFields(input: object): void {
  const forbidden = ["publication", "run", "baseline", "items", "combinations", "boots", "observations", "itemCatalog"];
  if (forbidden.some((field) => Object.prototype.hasOwnProperty.call(input, field))) throw new Error("canonical publication state must be loaded from the database");
}
