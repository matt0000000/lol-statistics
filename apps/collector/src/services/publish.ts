import { rebuildAggregates, type AggregateObservation, type Counter } from "./rebuild-aggregates";

export type InvariantFailure = { code: string; count: number };
export type VerificationReport = { valid: boolean; failures: InvariantFailure[] };
export class PublicationInvariantError extends Error {
  readonly failures: InvariantFailure[];
  constructor(failures: InvariantFailure[]) { super("publication invariants failed"); this.name = "PublicationInvariantError"; this.failures = failures; }
}

export type PublishInput = {
  publicationId: string;
  runId: string;
  patchId: number;
  publication?: { id: string; patchId: number; runId: string; isActive: boolean };
  run?: { id: string; status: string };
  baseline?: any[];
  items?: any[];
  combinations?: any[];
  boots?: any[];
  observations?: AggregateObservation[];
  itemCatalog?: ReadonlyMap<number, { category?: string; normalizedBaseId?: number }>;
  database?: any;
  repository?: PublishRepository;
};

export type PublishRepository = {
  getPublication?: (id: string, tx?: any) => Promise<any>;
  getRun?: (id: string, tx?: any) => Promise<any>;
  getAggregates?: (id: string, tx?: any) => Promise<{ baseline: any[]; items: any[]; combinations: any[]; boots: any[] }>;
  getObservations?: (patchId: number, tx?: any) => Promise<AggregateObservation[]>;
  deactivateCurrent: (tx: any) => Promise<unknown>;
  activate: (tx: any, publicationId: string) => Promise<unknown>;
  markRunPublished: (tx: any, runId: string, publicationId: string) => Promise<unknown>;
};

function countFailure(map: Map<string, number>, code: string, count = 1) { if (count > 0) map.set(code, (map.get(code) ?? 0) + count); }
function equation(row: any): boolean { return Number(row.wins) + Number(row.losses) === Number(row.sample) && Number(row.wins) >= 0 && Number(row.losses) >= 0 && Number(row.sample) >= 0; }
function aggregateKey(row: any, extra = ""): string { return [row.championId, row.role, row.itemId ?? row.size ?? "", row.combinationKey ?? extra].join(":"); }

export async function verifyPublication(input: PublishInput): Promise<VerificationReport> {
  let publication = input.publication;
  let run = input.run;
  let aggregates = { baseline: input.baseline ?? [], items: input.items ?? [], combinations: input.combinations ?? [], boots: input.boots ?? [] };
  let observations = input.observations ?? [];
  if (input.repository) {
    publication ??= await input.repository.getPublication?.(input.publicationId, input.database);
    run ??= await input.repository.getRun?.(input.runId, input.database);
    if (!input.baseline && input.repository.getAggregates) aggregates = await input.repository.getAggregates(input.publicationId, input.database);
    if (!input.observations && input.repository.getObservations) observations = await input.repository.getObservations(input.patchId, input.database);
  }
  const failures = new Map<string, number>();
  if (!publication || publication.id !== input.publicationId || publication.patchId !== input.patchId || publication.runId !== input.runId || publication.isActive) countFailure(failures, "PUBLICATION_NOT_ELIGIBLE");
  if (run && (run.id !== input.runId || !["COMPLETED", "RUNNING"].includes(run.status))) countFailure(failures, "RUN_NOT_ELIGIBLE");

  const baselineByGroup = new Map<string, any>();
  const missingBaselineGroups = new Set<string>();
  for (const row of aggregates.baseline) {
    if (!equation(row)) countFailure(failures, "COUNT_EQUATION");
    baselineByGroup.set(`${row.championId}:${row.role}`, row);
  }
  const allAgg = [...aggregates.items, ...aggregates.combinations, ...aggregates.boots];
  for (const row of allAgg) {
    if (!equation(row)) countFailure(failures, "COUNT_EQUATION");
    const base = baselineByGroup.get(`${row.championId}:${row.role}`);
    if (!base) missingBaselineGroups.add(`${row.championId}:${row.role}`);
    else if (Number(row.sample) > Number(base.sample)) countFailure(failures, "AGGREGATE_SAMPLE_ABOVE_BASELINE");
  }
  const groups = new Set(observations.map((o) => `${o.championId}:${o.role}`));
  for (const group of groups) if (!baselineByGroup.has(group)) missingBaselineGroups.add(group);
  countFailure(failures, "MISSING_BASELINE", missingBaselineGroups.size);
  const identities = new Set<string>();
  for (const row of observations) {
    const identity = `${row.matchId}:${row.participantId}`;
    if (identities.has(identity)) countFailure(failures, "DUPLICATE_PARTICIPANT_IDENTITY");
    identities.add(identity);
    if (row.queueId !== undefined && row.queueId !== 420 || row.platformId !== undefined && row.platformId !== "TR1" || row.validationState !== undefined && row.validationState !== "VALID" || row.patchId !== undefined && row.patchId !== input.patchId) countFailure(failures, "INVALID_OBSERVATION");
    for (const raw of row.items ?? []) {
      const id = typeof raw === "number" ? raw : raw.itemId;
      const catalog = input.itemCatalog?.get(id);
      if (input.itemCatalog && !catalog) countFailure(failures, "UNKNOWN_ITEM");
      else if (typeof raw !== "number" && raw.category && raw.category !== "CORE" || catalog && catalog.category !== "CORE") countFailure(failures, "WRONG_CATEGORY_ITEM");
    }
  }
  for (const row of aggregates.items) {
    const catalog = input.itemCatalog?.get(Number(row.itemId));
    if (input.itemCatalog && !catalog) countFailure(failures, "UNKNOWN_ITEM");
    else if (catalog && catalog.category !== "CORE") countFailure(failures, "WRONG_CATEGORY_ITEM");
  }
  for (const row of aggregates.boots) {
    const catalog = input.itemCatalog?.get(Number(row.itemId));
    if (input.itemCatalog && !catalog) countFailure(failures, "UNKNOWN_ITEM");
    else if (catalog && catalog.category !== "BOOTS") countFailure(failures, "WRONG_CATEGORY_ITEM");
  }

  if (observations.length > 0) {
    const recomputed = await rebuildAggregates({ publicationId: input.publicationId, source: observations, catalog: input.itemCatalog });
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
    const sort = (rows: any[]) => rows.map((r) => JSON.stringify(r)).sort();
    if (JSON.stringify(sort(expected)) !== JSON.stringify(sort(actual))) countFailure(failures, "RECOMPUTATION_MISMATCH");
  }
  return { valid: failures.size === 0, failures: [...failures].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })) };
}

export async function publishAtomically(input: PublishInput): Promise<void> {
  if (!input.database || !input.repository) throw new Error("publication database and repository are required");
  await input.database.transaction(async (tx: any) => {
    const report = await verifyPublication({ ...input, database: tx });
    if (!report.valid) throw new PublicationInvariantError(report.failures);
    await input.repository!.deactivateCurrent(tx);
    await input.repository!.activate(tx, input.publicationId);
    await input.repository!.markRunPublished(tx, input.runId, input.publicationId);
  }, { isolationLevel: "serializable" });
}
