import { and, asc, eq, sql } from "drizzle-orm";
import { aggregatePublications, baselineAggregates, bootsAggregates, collectionRuns, combinationAggregates, itemAggregates, items, matches, participantBoots, participantCoreItems, participantObservations, patches } from "../schema";
type Counter = { wins: number; losses: number; sample: number };
type AggregateGroup = { championId: number; role: string; baseline: Counter; items: Map<number, Counter>; pairs: Map<string, Counter>; trios: Map<string, Counter>; boots: Map<number, Counter> };
export type CanonicalAggregateObservation = { championId: number; role: string; matchId: string; participantId: number; win: boolean; items: { itemId: number; quantity: number; category?: string; normalizedBaseId?: number }[]; boots?: number | { itemId: number; category?: string; normalizedBaseId?: number }; patchId?: number; queueId?: number; platformId?: string; validationState?: string };
type AggregateObservation = CanonicalAggregateObservation;

type Tx = any;
const tables = [baselineAggregates, itemAggregates, combinationAggregates, bootsAggregates] as const;

export class AggregatesRepository {
  constructor(private readonly db: any) {}

  /** Atomically obtains the single publication target owned by a run, creating
   * it and binding the run while holding the run row lock. */
  async ensurePublicationTarget(input: { runId: string; patchId: number; coverageStartedAt: Date; minimumSample: number }): Promise<{ id: string }> {
    return this.db.transaction(async (tx: Tx) => {
      const run = (await tx.select().from(collectionRuns).where(eq(collectionRuns.id, input.runId)).for("update").limit(1))[0];
      if (!run) throw new Error("collection run not found");
      if (run.patchId !== input.patchId) throw new Error("publication patch owner mismatch");
      const existing = (await tx.select({ id: aggregatePublications.id }).from(aggregatePublications).where(eq(aggregatePublications.runId, input.runId)).for("update").limit(1))[0];
      if (existing) {
        if (run.publicationId && run.publicationId !== existing.id) throw new Error("collection run publication owner mismatch");
        if (!run.publicationId) await tx.update(collectionRuns).set({ publicationId: existing.id, updatedAt: new Date() }).where(eq(collectionRuns.id, input.runId));
        return existing;
      }
      const [created] = await tx.insert(aggregatePublications).values({ patchId: input.patchId, runId: input.runId, coverageStartedAt: input.coverageStartedAt, minimumSample: input.minimumSample }).returning({ id: aggregatePublications.id });
      if (!created) throw new Error("publication could not be created");
      await tx.update(collectionRuns).set({ publicationId: created.id, updatedAt: new Date() }).where(eq(collectionRuns.id, input.runId));
      return created;
    });
  }
  private preparedOwner?: { publicationId: string; runId: string; patchId: number };
  private prepareAttempted = false;

  async preparePublication(owner: { publicationId: string; runId: string; patchId: number }): Promise<void> {
    if (this.prepareAttempted) throw new Error("aggregate sink already prepared");
    this.prepareAttempted = true;
    await this.db.transaction(async (tx: Tx) => {
      const row = (await tx.select().from(aggregatePublications).where(eq(aggregatePublications.id, owner.publicationId)).for("update").limit(1))[0];
      if (!row || row.isActive || row.runId !== owner.runId || row.patchId !== owner.patchId) throw new Error("aggregate rebuild requires an inactive owned publication");
      for (const table of tables) await tx.delete(table).where(eq(table.publicationId, owner.publicationId));
    });
    this.preparedOwner = { ...owner };
  }

  async flushGroup(group: AggregateGroup, tx?: Tx): Promise<void> {
    if (!tx) {
      await this.db.transaction(async (transaction: Tx) => this.flushGroup(group, transaction));
      return;
    }
    const owner = this.preparedOwner;
    if (!owner) throw new Error("aggregate sink must be prepared");
    const row = (await tx.select().from(aggregatePublications).where(eq(aggregatePublications.id, owner.publicationId)).for("update").limit(1))[0];
    if (!row || row.isActive || row.runId !== owner.runId || row.patchId !== owner.patchId) throw new Error("aggregate sink owner is no longer valid");
    const base = { publicationId: owner.publicationId, championId: group.championId, role: group.role };
    await tx.insert(baselineAggregates).values({ ...base, ...group.baseline }).onConflictDoUpdate({ target: [baselineAggregates.publicationId, baselineAggregates.championId, baselineAggregates.role], set: { wins: group.baseline.wins, losses: group.baseline.losses, sample: group.baseline.sample } });
    for (const [itemId, count] of group.items) await tx.insert(itemAggregates).values({ ...base, itemId, ...count }).onConflictDoUpdate({ target: [itemAggregates.publicationId, itemAggregates.championId, itemAggregates.role, itemAggregates.itemId], set: count });
    for (const [combinationKey, count] of group.pairs) await tx.insert(combinationAggregates).values({ ...base, size: 2, combinationKey, ...count }).onConflictDoUpdate({ target: [combinationAggregates.publicationId, combinationAggregates.championId, combinationAggregates.role, combinationAggregates.size, combinationAggregates.combinationKey], set: count });
    for (const [combinationKey, count] of group.trios) await tx.insert(combinationAggregates).values({ ...base, size: 3, combinationKey, ...count }).onConflictDoUpdate({ target: [combinationAggregates.publicationId, combinationAggregates.championId, combinationAggregates.role, combinationAggregates.size, combinationAggregates.combinationKey], set: count });
    for (const [itemId, count] of group.boots) await tx.insert(bootsAggregates).values({ ...base, itemId, ...count }).onConflictDoUpdate({ target: [bootsAggregates.publicationId, bootsAggregates.championId, bootsAggregates.role, bootsAggregates.itemId], set: count });
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
    await tx.select({ id: aggregatePublications.id }).from(aggregatePublications).where(eq(aggregatePublications.isActive, true)).for("update");
    const run = (await tx.select().from(collectionRuns).where(eq(collectionRuns.id, runId)).for("update").limit(1))[0];
    const patchId = publication?.patchId;
    const patch = patchId ? (await tx.select().from(patches).where(eq(patches.id, patchId)).for("update").limit(1))[0] : undefined;
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
