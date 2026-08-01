import { desc, eq, inArray, sql } from "drizzle-orm";
import { collectionRuns, runStatus } from "../schema";

export type CollectionRun = typeof collectionRuns.$inferSelect;
export type RunStatus = (typeof runStatus.enumValues)[number];

export type CollectionRunDatabase = {
  insert: (table: typeof collectionRuns) => any;
  select: (...args: any[]) => any;
  update: (table: typeof collectionRuns) => any;
};

const STAGE_ORDER = ["discovery", "snapshot", "ingest", "aggregate", "publish"] as const;
export const COLLECTION_STAGES = ["CATALOG", "LADDER", "DISCOVERY", "MATCHES", "AGGREGATES", "VERIFY", "PUBLISH"] as const;
type CollectionStage = (typeof COLLECTION_STAGES)[number];
const PERSISTED_STAGE: Record<CollectionStage, string> = { CATALOG: "catalog", LADDER: "ladder", DISCOVERY: "discovery", MATCHES: "matches", AGGREGATES: "aggregates", VERIFY: "verify", PUBLISH: "publish" };
const ERROR_CODES = new Set(["DISCOVERY_FAILED", "SNAPSHOT_FAILED", "INGEST_FAILED", "VALIDATION_FAILED", "UNKNOWN"]);
export type CollectionErrorDetails = { code: string; stage?: (typeof STAGE_ORDER)[number] };

/** Persistence boundary for resumable collection runs. */
export class CollectionRunRepository {
  constructor(private readonly db: any) {}

  /** Find a pending/running or failed run only when its immutable collection parameters match. */
  async resumeOrCreate(input: { patchId?: number; coverageDays?: number; minimumSample?: number } = {}): Promise<CollectionRun> {
    const coverageDays = input.coverageDays ?? 35;
    const minimumSample = input.minimumSample ?? 100;
    if (!Number.isSafeInteger(coverageDays) || coverageDays <= 0 || !Number.isSafeInteger(minimumSample) || minimumSample < 0) throw new Error("invalid collection parameters");
    const rows = await this.db.select().from(collectionRuns)
      .where(inArray(collectionRuns.status, ["PENDING", "RUNNING", "FAILED", "COMPLETED"]))
      .orderBy(desc(collectionRuns.updatedAt), desc(collectionRuns.startedAt));
    const sameConfig = (row: CollectionRun & { patchId?: number | null; coverageDays?: number; minimumSample?: number }) =>
      (row.patchId ?? null) === (input.patchId ?? null) && (row.coverageDays ?? 35) === coverageDays && (row.minimumSample ?? 100) === minimumSample
    ;
    // Completed runs are scheduler-idempotent: an invocation for the same
    // immutable patch/config returns the existing publication instead of
    // forking a duplicate run.
    const match = rows.find((row: CollectionRun & { patchId?: number | null; coverageDays?: number; minimumSample?: number }) => row.status === "COMPLETED" && sameConfig(row))
      ?? rows.find(sameConfig);
    if (match) return match;
    const [created] = await this.db.insert(collectionRuns).values({
      status: "PENDING",
      stage: "catalog",
      patchId: input.patchId,
      coverageDays,
      minimumSample
    }).returning();
    if (!created) throw new Error("collection run could not be created");
    return created;
  }

  async isStageComplete(runId: string, stage: string): Promise<boolean> {
    const run = await this.get(runId);
    if (!run) throw new Error("collection run not found");
    const target = normalizeStage(stage);
    if (run.status === "COMPLETED") return true;
    const current = normalizeStage(String(run.stage));
    return COLLECTION_STAGES.indexOf(current) > COLLECTION_STAGES.indexOf(target);
  }

  async markRunning(runId: string): Promise<CollectionRun> {
    return this.updateStatus(runId, "RUNNING");
  }

  /** Advance the durable stage only after its handler has committed all work. */
  async completeStage(runId: string, stage: string): Promise<CollectionRun> {
    const target = normalizeStage(stage);
    return this.db.transaction(async (tx: any) => {
      const current = await this.locked(tx, runId);
      const currentStage = normalizeStage(String(current.stage));
      if (current.status === "FAILED") throw new Error("collection run is not eligible");
      if (COLLECTION_STAGES.indexOf(currentStage) > COLLECTION_STAGES.indexOf(target)) return current;
      if (currentStage !== target && current.status !== "COMPLETED") throw new Error("collection stage is not current");
      const final = target === "PUBLISH";
      const next = final ? "PUBLISH" : COLLECTION_STAGES[COLLECTION_STAGES.indexOf(target) + 1];
      const values: Record<string, unknown> = { updatedAt: new Date(), stage: PERSISTED_STAGE[next] };
      if (final && current.status !== "COMPLETED") { values.status = "COMPLETED"; values.finishedAt = new Date(); }
      const [updated] = await tx.update(collectionRuns).set(values).where(eq(collectionRuns.id, runId)).returning();
      if (!updated) throw new Error("collection run not found");
      return updated;
    });
  }

  async markFailed(runId: string, category: string, detail: Record<string, unknown> = {}, stage?: string): Promise<CollectionRun> {
    if (!/^[a-z_]{1,64}$/.test(category)) throw new Error("invalid failure category");
    const safeDetail = Object.fromEntries(Object.entries(detail).filter(([key, value]) => /^(type|status|code)$/.test(key) && (typeof value === "string" || typeof value === "number")));
    const normalized = stage ? normalizeStage(stage) : undefined;
    const [updated] = await this.db.update(collectionRuns).set({ status: "FAILED", finishedAt: new Date(), ...(normalized ? { stage: PERSISTED_STAGE[normalized] } : {}), errorDetails: { category, detail: safeDetail }, updatedAt: new Date() }).where(eq(collectionRuns.id, runId)).returning();
    if (!updated) throw new Error("collection run not found");
    return updated;
  }

  async bindPatch(runId: string, patchId: number): Promise<CollectionRun> {
    if (!Number.isSafeInteger(patchId) || patchId < 1) throw new Error("invalid patch");
    const [updated] = await this.db.update(collectionRuns).set({ patchId, updatedAt: new Date() }).where(eq(collectionRuns.id, runId)).returning();
    if (!updated) throw new Error("collection run not found");
    return updated;
  }

  async bindPublication(runId: string, publicationId: string): Promise<CollectionRun> {
    const [updated] = await this.db.update(collectionRuns).set({ publicationId, updatedAt: new Date() }).where(eq(collectionRuns.id, runId)).returning();
    if (!updated) throw new Error("collection run not found");
    return updated;
  }

  /** Checks publication ownership and active state without mutating a terminal run. */
  async isActivePublication(run: CollectionRun): Promise<boolean> {
    if (run.status !== "COMPLETED" || !run.publicationId) return false;
    const rows = await this.db.execute(sql`SELECT 1 FROM aggregate_publications WHERE id = ${run.publicationId} AND run_id = ${run.id} AND is_active = true LIMIT 1`);
    return rows.length > 0;
  }

  async createOrResume(runId?: string): Promise<CollectionRun> {
    if (runId) {
      const existing = await this.get(runId);
      if (existing) return existing;
    } else {
      const active = await this.db.select().from(collectionRuns)
        .where(inArray(collectionRuns.status, ["PENDING", "RUNNING"]))
        .orderBy(desc(collectionRuns.updatedAt), desc(collectionRuns.startedAt)).limit(1);
      if (active[0]) return active[0];
    }
    const values = runId ? { id: runId } : {};
    const [created] = await this.db.insert(collectionRuns).values(values).returning();
    if (!created) throw new Error("collection run could not be created");
    return created;
  }

  resume(runId?: string): Promise<CollectionRun> {
    return this.createOrResume(runId);
  }

  create(runId?: string): Promise<CollectionRun> {
    return this.createOrResume(runId);
  }

  async get(runId: string): Promise<CollectionRun | undefined> {
    const rows = await this.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId)).limit(1);
    return rows[0];
  }

  async updateStage(runId: string, stage: string): Promise<CollectionRun> {
    const normalized = normalizeStage(stage);
    return this.db.transaction(async (tx: any) => {
      const current = await this.locked(tx, runId);
      if (current.status === "COMPLETED" || current.status === "FAILED") throw new Error("collection run is not eligible");
      const currentRank = COLLECTION_STAGES.indexOf(normalizeStage(String(current.stage)));
      const nextRank = COLLECTION_STAGES.indexOf(normalized);
      if (nextRank < currentRank) throw new Error("collection stage regression");
      const [updated] = await tx.update(collectionRuns).set({ stage: PERSISTED_STAGE[normalized], updatedAt: new Date() }).where(eq(collectionRuns.id, runId)).returning();
      return updated;
    });
  }

  async updateStatus(runId: string, status: RunStatus, errorDetails?: unknown): Promise<CollectionRun> {
    const details = errorDetails === undefined ? undefined : safeErrorDetails(errorDetails);
    return this.db.transaction(async (tx: any) => {
    const current = await this.locked(tx, runId);
    const allowed: Record<RunStatus, RunStatus[]> = {
      PENDING: ["PENDING", "RUNNING", "FAILED"],
      RUNNING: ["RUNNING", "COMPLETED", "FAILED"],
      COMPLETED: ["COMPLETED"],
      FAILED: ["FAILED", "RUNNING"]
    };
    if (!allowed[current.status].includes(status)) throw new Error("invalid collection status transition");
    const values: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "COMPLETED" || status === "FAILED") values.finishedAt = new Date();
    else if (status === "RUNNING") { values.finishedAt = null; values.errorDetails = null; }
    if (status !== "RUNNING" && details !== undefined) values.errorDetails = details;
    const [updated] = await tx.update(collectionRuns).set(values).where(eq(collectionRuns.id, runId)).returning();
    return updated;
    });
  }

  async updateCounters(runId: string, counters: Partial<Pick<CollectionRun, "matchesDiscovered" | "matchesIngested" | "observationsAccepted" | "observationsRejected">>): Promise<CollectionRun> {
    return this.db.transaction(async (tx: any) => {
      await this.lockedEligible(tx, runId);
      const values = counterValues(counters);
      const [updated] = await tx.update(collectionRuns).set({ ...values, updatedAt: new Date() }).where(eq(collectionRuns.id, runId)).returning();
      if (!updated) throw new Error("collection run not found");
      return updated;
    });
  }

  async incrementCounters(runId: string, counters: Partial<Pick<CollectionRun, "matchesDiscovered" | "matchesIngested" | "observationsAccepted" | "observationsRejected">>): Promise<CollectionRun> {
    return this.db.transaction(async (tx: any) => {
      await this.lockedEligible(tx, runId);
      const columns = {
        matchesDiscovered: collectionRuns.matchesDiscovered,
        matchesIngested: collectionRuns.matchesIngested,
        observationsAccepted: collectionRuns.observationsAccepted,
        observationsRejected: collectionRuns.observationsRejected
      };
      const values: Record<string, unknown> = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(counters)) {
        validateCounter(key, value);
        values[key] = sql`${columns[key as keyof typeof columns]} + ${value}`;
      }
      const [updated] = await tx.update(collectionRuns).set(values).where(eq(collectionRuns.id, runId)).returning();
      if (!updated) throw new Error("collection run not found");
      return updated;
    });
  }

  private async applyUpdate(runId: string, values: Partial<typeof collectionRuns.$inferInsert>): Promise<CollectionRun> {
    const [updated] = await this.db.update(collectionRuns).set({ ...values, updatedAt: new Date() }).where(eq(collectionRuns.id, runId)).returning();
    if (!updated) throw new Error("collection run not found");
    return updated;
  }

  private async locked(tx: any, runId: string): Promise<CollectionRun> {
    const rows = await tx.select().from(collectionRuns).where(eq(collectionRuns.id, runId)).for("update").limit(1);
    if (!rows[0]) throw new Error("collection run not found");
    return rows[0];
  }

  private async require(runId: string): Promise<CollectionRun> {
    const run = await this.get(runId);
    if (!run) throw new Error("collection run not found");
    return run;
  }

  private async lockedEligible(tx: any, runId: string): Promise<CollectionRun> {
    const run = await this.locked(tx, runId);
    if (run.status !== "PENDING" && run.status !== "RUNNING") throw new Error("collection run is not eligible");
    return run;
  }
}

function counterValues(counters: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(counters)) {
    validateCounter(key, value);
    values[key] = value;
  }
  return values;
}

function validateCounter(key: string, value: unknown): void {
  if (!["matchesDiscovered", "matchesIngested", "observationsAccepted", "observationsRejected"].includes(key) || !Number.isSafeInteger(value) || (value as number) < 0) throw new Error("invalid collection counter");
}

function safeErrorDetails(value: unknown): CollectionErrorDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid collection error details");
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string" || !ERROR_CODES.has(record.code)) throw new Error("invalid collection error details");
  const result: CollectionErrorDetails = { code: record.code };
  if (record.stage !== undefined) {
    if (typeof record.stage !== "string" || !STAGE_ORDER.includes(record.stage as any)) throw new Error("invalid collection error details");
    result.stage = record.stage as CollectionErrorDetails["stage"];
  }
  if (Object.keys(record).some((key) => key !== "code" && key !== "stage")) throw new Error("invalid collection error details");
  return result;
}

function normalizeStage(value: string): CollectionStage {
  const upper = value.toUpperCase();
  if ((COLLECTION_STAGES as readonly string[]).includes(upper)) return upper as CollectionStage;
  // Preserve compatibility with the original five-stage repository API.
  const aliases: Record<string, CollectionStage> = { DISCOVERY: "DISCOVERY", SNAPSHOT: "LADDER", INGEST: "MATCHES", AGGREGATE: "AGGREGATES", PUBLISH: "PUBLISH" };
  const mapped = aliases[upper];
  if (mapped) return mapped;
  throw new Error("invalid collection stage");
}
