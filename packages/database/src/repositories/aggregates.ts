import { and, asc, eq, sql } from "drizzle-orm";
import { aggregatePublications, baselineAggregates, bootsAggregates, collectionRuns, combinationAggregates, itemAggregates, items, matches, participantBoots, participantCoreItems, participantObservations, patches } from "../schema";
type Counter = { wins: number; losses: number; sample: number };
type AggregateGroup = { championId: number; role: string; baseline: Counter; items: Map<number, Counter>; pairs: Map<string, Counter>; trios: Map<string, Counter>; boots: Map<number, Counter> };
export type CanonicalAggregateObservation = { championId: number; role: string; matchId: string; participantId: number; win: boolean; items: { itemId: number; quantity: number; category?: string; normalizedBaseId?: number }[]; boots?: number | { itemId: number; category?: string; normalizedBaseId?: number }; patchId?: number; queueId?: number; platformId?: string; validationState?: string };
type AggregateSink = { flushGroup?: (publicationId: string, group: AggregateGroup) => Promise<void> | void; replacePublication?: (publicationId: string, groups: Iterable<AggregateGroup>) => Promise<void> | void };
type AggregateObservation = CanonicalAggregateObservation;

type Tx = any;
const tables = [baselineAggregates, itemAggregates, combinationAggregates, bootsAggregates] as const;

export class AggregatesRepository implements AggregateSink {
  constructor(private readonly db: any) {}

  async preparePublication(publicationId: string, runId?: string, patchId?: number): Promise<void> {
    await this.db.transaction(async (tx: Tx) => {
      const owner = (await tx.select({ id: aggregatePublications.id, isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).for("update").limit(1))[0];
      const full = (await tx.select().from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).for("update").limit(1))[0];
      if (!owner || owner.isActive || runId !== undefined && full.runId !== runId || patchId !== undefined && full.patchId !== patchId) throw new Error("aggregate rebuild requires an inactive owned publication");
      for (const table of tables) await tx.delete(table).where(eq(table.publicationId, publicationId));
    });
  }

  async flushGroup(publicationId: string, group: AggregateGroup, tx: Tx = this.db): Promise<void> {
    const owner = (await tx.select({ isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).for("update").limit(1))[0];
    if (!owner || owner.isActive) throw new Error("aggregate writes require an inactive publication");
    const base = { publicationId, championId: group.championId, role: group.role };
    await tx.insert(baselineAggregates).values({ ...base, ...group.baseline }).onConflictDoUpdate({ target: [baselineAggregates.publicationId, baselineAggregates.championId, baselineAggregates.role], set: { wins: group.baseline.wins, losses: group.baseline.losses, sample: group.baseline.sample } });
    for (const [itemId, count] of group.items) await tx.insert(itemAggregates).values({ ...base, itemId, ...count }).onConflictDoUpdate({ target: [itemAggregates.publicationId, itemAggregates.championId, itemAggregates.role, itemAggregates.itemId], set: count });
    for (const [combinationKey, count] of group.pairs) await tx.insert(combinationAggregates).values({ ...base, size: 2, combinationKey, ...count }).onConflictDoUpdate({ target: [combinationAggregates.publicationId, combinationAggregates.championId, combinationAggregates.role, combinationAggregates.size, combinationAggregates.combinationKey], set: count });
    for (const [combinationKey, count] of group.trios) await tx.insert(combinationAggregates).values({ ...base, size: 3, combinationKey, ...count }).onConflictDoUpdate({ target: [combinationAggregates.publicationId, combinationAggregates.championId, combinationAggregates.role, combinationAggregates.size, combinationAggregates.combinationKey], set: count });
    for (const [itemId, count] of group.boots) await tx.insert(bootsAggregates).values({ ...base, itemId, ...count }).onConflictDoUpdate({ target: [bootsAggregates.publicationId, bootsAggregates.championId, bootsAggregates.role, bootsAggregates.itemId], set: count });
  }

  async replacePublication(publicationId: string, groups: Iterable<AggregateGroup>): Promise<void> {
    await this.db.transaction(async (tx: Tx) => {
      const owner = (await tx.select({ id: aggregatePublications.id, isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).for("update").limit(1))[0];
      if (!owner || owner.isActive) throw new Error("aggregate rebuild requires an inactive publication");
      for (const table of tables) await tx.delete(table).where(eq(table.publicationId, publicationId));
      for (const group of groups) await this.flushGroup(publicationId, group, tx);
    });
  }

  async rows(publicationId: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (const table of tables) out.push(...await this.db.select().from(table).where(eq(table.publicationId, publicationId)));
    return out.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  async getAggregates(publicationId: string, tx: Tx = this.db) {
    const [baseline, itemRows, combinations, boots] = await Promise.all([
      tx.select().from(baselineAggregates).where(eq(baselineAggregates.publicationId, publicationId)),
      tx.select().from(itemAggregates).where(eq(itemAggregates.publicationId, publicationId)),
      tx.select().from(combinationAggregates).where(eq(combinationAggregates.publicationId, publicationId)),
      tx.select().from(bootsAggregates).where(eq(bootsAggregates.publicationId, publicationId))
    ]);
    return { baseline, items: itemRows, combinations, boots };
  }

  async getPublication(id: string, tx: Tx = this.db) { return (await tx.select().from(aggregatePublications).where(eq(aggregatePublications.id, id)).limit(1))[0]; }
  async getRun(id: string, tx: Tx = this.db) { return (await tx.select().from(collectionRuns).where(eq(collectionRuns.id, id)).limit(1))[0]; }

  /** Lock every canonical row participating in publication verification. */
  async lockAndLoad(tx: Tx, publicationId: string, runId: string): Promise<any> {
    const publication = (await tx.select().from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).for("update").limit(1))[0];
    const run = (await tx.select().from(collectionRuns).where(eq(collectionRuns.id, runId)).for("update").limit(1))[0];
    const patchId = publication?.patchId;
    const patch = patchId ? (await tx.select().from(patches).where(eq(patches.id, patchId)).for("update").limit(1))[0] : undefined;
    await tx.select().from(aggregatePublications).where(eq(aggregatePublications.isActive, true)).for("update");
    const [baseline, itemRows, combinations, boots] = await Promise.all([
      tx.select().from(baselineAggregates).where(eq(baselineAggregates.publicationId, publicationId)).for("update"),
      tx.select().from(itemAggregates).where(eq(itemAggregates.publicationId, publicationId)).for("update"),
      tx.select().from(combinationAggregates).where(eq(combinationAggregates.publicationId, publicationId)).for("update"),
      tx.select().from(bootsAggregates).where(eq(bootsAggregates.publicationId, publicationId)).for("update")
    ]);
    const catalogRows = patchId ? await tx.select().from(items).where(eq(items.patchId, patchId)).for("update") : [];
    const catalog = new Map(catalogRows.map((row: any) => [row.itemId, row]));
    const observations = patchId ? await this.loadSourceRows(tx, patchId) : [];
    return { publicationId, runId, patchId: publication?.patchId, publication, run, patch, baseline, items: itemRows, combinations, boots, observations, itemCatalog: catalog };
  }

  private async loadSourceRows(db: Tx, patchId: number): Promise<CanonicalAggregateObservation[]> {
    const joined = await db.select().from(participantObservations).innerJoin(matches, eq(matches.matchId, participantObservations.matchId)).where(eq(participantObservations.patchId, patchId)).orderBy(asc(participantObservations.championId), asc(participantObservations.role), asc(participantObservations.matchId), asc(participantObservations.participantId)).for("update");
    const rows: CanonicalAggregateObservation[] = [];
    for (const entry of joined) {
      const o = entry.participant_observations;
      const cores = await db.select({ itemId: participantCoreItems.itemId, quantity: participantCoreItems.quantity, category: items.category, normalizedBaseId: items.normalizedBaseId }).from(participantCoreItems).innerJoin(items, and(eq(items.patchId, participantCoreItems.patchId), eq(items.itemId, participantCoreItems.itemId))).where(and(eq(participantCoreItems.matchId, o.matchId), eq(participantCoreItems.participantId, o.participantId), eq(participantCoreItems.patchId, patchId))).for("update");
      const boots = (await db.select({ itemId: participantBoots.itemId, category: items.category, normalizedBaseId: items.normalizedBaseId }).from(participantBoots).innerJoin(items, and(eq(items.patchId, participantBoots.patchId), eq(items.itemId, participantBoots.itemId))).where(and(eq(participantBoots.matchId, o.matchId), eq(participantBoots.participantId, o.participantId))).limit(1).for("update"))[0];
      rows.push({ championId: o.championId, role: o.role, matchId: o.matchId, participantId: o.participantId, win: o.win, items: cores, boots, patchId, queueId: entry.matches.queueId, platformId: entry.matches.platformId, validationState: entry.matches.validationState });
    }
    return rows;
  }

  async getObservations(patchId: number, tx: Tx = this.db): Promise<CanonicalAggregateObservation[]> {
    const result: CanonicalAggregateObservation[] = [];
    let cursor: { championId: number; role: string; matchId: string; participantId: number } | undefined;
    while (true) {
      const page = await this.observationPage(patchId, cursor, 500, tx);
      result.push(...page.rows);
      if (!page.nextCursor || page.rows.length === 0) break;
      cursor = page.nextCursor;
    }
    return result;
  }

  /** Safe single activation mutation; caller must have verified/locked canonical state. */
  async activateVerified(tx: Tx, publicationId: string, runId: string): Promise<boolean> {
    const target = (await tx.select().from(aggregatePublications).where(and(eq(aggregatePublications.id, publicationId), eq(aggregatePublications.runId, runId), eq(aggregatePublications.isActive, false))).for("update").limit(1))[0];
    if (!target) return false;
    const active = await tx.select({ id: aggregatePublications.id }).from(aggregatePublications).where(eq(aggregatePublications.isActive, true)).for("update");
    await tx.update(aggregatePublications).set({ isActive: false }).where(eq(aggregatePublications.isActive, true));
    const changed = await tx.update(aggregatePublications).set({ isActive: true }).where(and(eq(aggregatePublications.id, publicationId), eq(aggregatePublications.isActive, false))).returning({ id: aggregatePublications.id });
    if (changed.length !== 1) throw new Error("publication activation changed no rows");
    const updatedRun = await tx.update(collectionRuns).set({ status: "COMPLETED", publicationId, finishedAt: new Date(), updatedAt: new Date() }).where(and(eq(collectionRuns.id, runId), sql`(${collectionRuns.publicationId} IS NULL OR ${collectionRuns.publicationId} = ${publicationId})`)).returning({ id: collectionRuns.id });
    if (updatedRun.length !== 1) throw new Error("run publication changed no rows");
    const updatedPatch = await tx.update(patches).set({ publishedAt: new Date() }).where(eq(patches.id, target.patchId)).returning({ id: patches.id });
    if (updatedPatch.length !== 1) throw new Error("patch publication changed no rows");
    return active.length >= 0;
  }

  async observationPage(patchId: number, cursor?: { championId: number; role: string; matchId: string; participantId: number }, pageSize = 500, db: Tx = this.db): Promise<{ rows: AggregateObservation[]; nextCursor?: typeof cursor }> {
    const conditions = [eq(participantObservations.patchId, patchId), eq(matches.patchId, patchId), eq(matches.validationState, "VALID"), eq(matches.platformId, "TR1"), eq(matches.queueId, 420)];
    if (cursor) conditions.push(sql`(${participantObservations.championId}, ${participantObservations.role}, ${participantObservations.matchId}, ${participantObservations.participantId}) > (${cursor.championId}, ${cursor.role}, ${cursor.matchId}, ${cursor.participantId})` as any);
    const obs = await db.select().from(participantObservations).innerJoin(matches, eq(matches.matchId, participantObservations.matchId)).where(and(...conditions)).orderBy(asc(participantObservations.championId), asc(participantObservations.role), asc(participantObservations.matchId), asc(participantObservations.participantId)).limit(pageSize);
    const rows: AggregateObservation[] = [];
    for (const entry of obs) {
      const o = entry.participant_observations;
      const cores = await db.select({ itemId: participantCoreItems.itemId, quantity: participantCoreItems.quantity, category: items.category, normalizedBaseId: items.normalizedBaseId }).from(participantCoreItems).innerJoin(items, and(eq(items.patchId, participantCoreItems.patchId), eq(items.itemId, participantCoreItems.itemId))).where(and(eq(participantCoreItems.matchId, o.matchId), eq(participantCoreItems.participantId, o.participantId), eq(participantCoreItems.patchId, patchId)));
      const boots = (await db.select({ itemId: participantBoots.itemId, category: items.category, normalizedBaseId: items.normalizedBaseId }).from(participantBoots).innerJoin(items, and(eq(items.patchId, participantBoots.patchId), eq(items.itemId, participantBoots.itemId))).where(and(eq(participantBoots.matchId, o.matchId), eq(participantBoots.participantId, o.participantId))).limit(1))[0];
      rows.push({ championId: o.championId, role: o.role, matchId: o.matchId, participantId: o.participantId, win: o.win, items: cores, boots: boots?.itemId, patchId, queueId: entry.matches.queueId, platformId: entry.matches.platformId, validationState: entry.matches.validationState });
    }
    const last = rows.at(-1);
    return { rows, nextCursor: last ? { championId: last.championId, role: last.role, matchId: last.matchId, participantId: last.participantId } : undefined };
  }
}
