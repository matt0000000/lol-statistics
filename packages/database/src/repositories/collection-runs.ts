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
const ERROR_CODES = new Set(["DISCOVERY_FAILED", "SNAPSHOT_FAILED", "INGEST_FAILED", "VALIDATION_FAILED", "UNKNOWN"]);
export type CollectionErrorDetails = { code: string; stage?: (typeof STAGE_ORDER)[number] };

/** Persistence boundary for resumable collection runs. */
export class CollectionRunRepository {
  constructor(private readonly db: any) {}

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
    if (!STAGE_ORDER.includes(stage as (typeof STAGE_ORDER)[number])) throw new Error("invalid collection stage");
    return this.db.transaction(async (tx: any) => {
      const current = await this.locked(tx, runId);
      const currentRank = STAGE_ORDER.indexOf(current.stage as (typeof STAGE_ORDER)[number]);
      const nextRank = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
      if (nextRank < currentRank) throw new Error("collection stage regression");
      const [updated] = await tx.update(collectionRuns).set({ stage, updatedAt: new Date() }).where(eq(collectionRuns.id, runId)).returning();
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
    await this.requireEligible(runId);
    const values: Record<string, unknown> = { updatedAt: new Date() };
    const allowedKeys = new Set(["matchesDiscovered", "matchesIngested", "observationsAccepted", "observationsRejected"]);
    for (const [key, value] of Object.entries(counters)) {
      if (!allowedKeys.has(key)) throw new Error("invalid collection counter");
      if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("invalid collection counter");
      values[key] = value;
    }
    return this.applyUpdate(runId, values);
  }

  async incrementCounters(runId: string, counters: Partial<Pick<CollectionRun, "matchesDiscovered" | "matchesIngested" | "observationsAccepted" | "observationsRejected">>): Promise<CollectionRun> {
    await this.requireEligible(runId);
    const values: Record<string, unknown> = { updatedAt: new Date() };
    const allowedKeys = new Set(["matchesDiscovered", "matchesIngested", "observationsAccepted", "observationsRejected"]);
    const columns = {
      matchesDiscovered: collectionRuns.matchesDiscovered,
      matchesIngested: collectionRuns.matchesIngested,
      observationsAccepted: collectionRuns.observationsAccepted,
      observationsRejected: collectionRuns.observationsRejected
    };
    for (const [key, value] of Object.entries(counters)) {
      if (!allowedKeys.has(key)) throw new Error("invalid collection counter");
      if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("invalid collection counter");
      values[key] = sql`${columns[key as keyof typeof columns]} + ${value}`;
    }
    return this.applyUpdate(runId, values);
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

  private async requireEligible(runId: string): Promise<CollectionRun> {
    const run = await this.require(runId);
    if (run.status !== "PENDING" && run.status !== "RUNNING") throw new Error("collection run is not eligible");
    return run;
  }
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
