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

  async flushGroup(publicationId: string, group: AggregateGroup, tx: Tx = this.db): Promise<void> {
    const base = { publicationId, championId: group.championId, role: group.role };
    await tx.insert(baselineAggregates).values({ ...base, ...group.baseline }).onConflictDoUpdate({ target: [baselineAggregates.publicationId, baselineAggregates.championId, baselineAggregates.role], set: { wins: group.baseline.wins, losses: group.baseline.losses, sample: group.baseline.sample } });
    for (const [itemId, count] of group.items) await tx.insert(itemAggregates).values({ ...base, itemId, ...count }).onConflictDoUpdate({ target: [itemAggregates.publicationId, itemAggregates.championId, itemAggregates.role, itemAggregates.itemId], set: count });
    for (const [combinationKey, count] of group.pairs) await tx.insert(combinationAggregates).values({ ...base, size: 2, combinationKey, ...count }).onConflictDoUpdate({ target: [combinationAggregates.publicationId, combinationAggregates.championId, combinationAggregates.role, combinationAggregates.size, combinationAggregates.combinationKey], set: count });
    for (const [combinationKey, count] of group.trios) await tx.insert(combinationAggregates).values({ ...base, size: 3, combinationKey, ...count }).onConflictDoUpdate({ target: [combinationAggregates.publicationId, combinationAggregates.championId, combinationAggregates.role, combinationAggregates.size, combinationAggregates.combinationKey], set: count });
    for (const [itemId, count] of group.boots) await tx.insert(bootsAggregates).values({ ...base, itemId, ...count }).onConflictDoUpdate({ target: [bootsAggregates.publicationId, bootsAggregates.championId, bootsAggregates.role, bootsAggregates.itemId], set: count });
  }

  async replacePublication(publicationId: string, groups: Iterable<AggregateGroup>): Promise<void> {
    await this.db.transaction(async (tx: Tx) => {
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

  async deactivateCurrent(tx: Tx = this.db): Promise<void> { await tx.update(aggregatePublications).set({ isActive: false }).where(eq(aggregatePublications.isActive, true)); }
  async activate(tx: Tx, publicationId: string): Promise<void> {
    const row = (await tx.select().from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).for("update").limit(1))[0];
    if (!row || row.isActive) throw new Error("publication is not eligible");
    await tx.update(aggregatePublications).set({ isActive: true }).where(eq(aggregatePublications.id, publicationId));
  }
  async markRunPublished(tx: Tx, runId: string, publicationId: string): Promise<void> {
    await tx.update(collectionRuns).set({ status: "COMPLETED", publicationId, finishedAt: new Date(), updatedAt: new Date() }).where(eq(collectionRuns.id, runId));
    const publication = (await tx.select({ patchId: aggregatePublications.patchId }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).limit(1))[0];
    if (publication) await tx.update(patches).set({ publishedAt: new Date() }).where(eq(patches.id, publication.patchId));
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
