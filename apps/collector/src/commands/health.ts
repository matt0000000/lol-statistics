import { and, desc, eq, inArray } from "drizzle-orm";
import { aggregatePublications, collectionRuns, createDatabase, patches, participantRejections } from "@lol/database";

export type HealthOptions = { env?: Record<string, string | undefined>; json?: boolean; write?: (line: string) => void; database?: ReturnType<typeof createDatabase> };
export type HealthSnapshot = {
  patch: string | null;
  status: string;
  datasetState: "ready" | "dataset_warming";
  runStatus: string;
  stage: string;
  dataAge: string | null;
  counters: { matchesDiscovered: number; matchesIngested: number; observationsAccepted: number; observationsRejected: number };
  unknownItemCount: number;
  errorCategory: string | null;
};

export function deriveHealthSnapshot(input: { currentPatch?: { id: number; patchKey: string } | null; activePublication?: { id: string; patchId: number; collectedAt?: Date | string | null; } | null; run?: { status?: string | null; stage?: string | null; matchesDiscovered?: number; matchesIngested?: number; observationsAccepted?: number; observationsRejected?: number; errorDetails?: unknown } | null; unknownItemCount?: number }): HealthSnapshot {
  const ready = Boolean(input.currentPatch && input.activePublication && input.activePublication.patchId === input.currentPatch.id);
  const run = input.run;
  return {
    patch: input.currentPatch?.patchKey ?? null,
    status: ready ? (run?.status ?? "COMPLETED") : "dataset_warming",
    datasetState: ready ? "ready" : "dataset_warming",
    runStatus: run?.status ?? "IDLE",
    stage: run?.stage ?? "catalog",
    dataAge: ready && input.activePublication?.collectedAt ? new Date(input.activePublication.collectedAt).toISOString() : null,
    counters: {
      matchesDiscovered: run?.matchesDiscovered ?? 0,
      matchesIngested: run?.matchesIngested ?? 0,
      observationsAccepted: run?.observationsAccepted ?? 0,
      observationsRejected: run?.observationsRejected ?? 0
    },
    unknownItemCount: input.unknownItemCount ?? 0,
    errorCategory: publicErrorCategory(run?.errorDetails)
  };
}

export async function healthCommand(options: HealthOptions = {}): Promise<number> {
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  let database = options.database;
  let owned = false;
  try {
    const url = options.env?.DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("database configuration unavailable");
    if (!database) { database = createDatabase(url, { max: 2, connect_timeout: 1 }); owned = true; }
    const [currentPatch] = await database.db.select({ id: patches.id, patchKey: patches.patchKey }).from(patches).where(eq(patches.isActive, true)).limit(1);
    const [candidatePublication] = await database.db.select().from(aggregatePublications).where(eq(aggregatePublications.isActive, true)).limit(1);
    const activePublication = candidatePublication && currentPatch && candidatePublication.patchId === currentPatch.id ? candidatePublication : undefined;
    const [run] = currentPatch
      ? await database.db.select().from(collectionRuns).where(and(inArray(collectionRuns.status, ["PENDING", "RUNNING", "FAILED", "COMPLETED"]), eq(collectionRuns.patchId, currentPatch.id))).orderBy(desc(collectionRuns.updatedAt)).limit(1)
      : [];
    const unknownRows = run ? await database.db.select({ participantId: participantRejections.participantId }).from(participantRejections).where(and(eq(participantRejections.patchId, run.patchId ?? -1), eq(participantRejections.reason, "unknown_item"))) : [];
    const snapshot = deriveHealthSnapshot({ currentPatch, activePublication, run, unknownItemCount: unknownRows.length });
    write(options.json ? `${JSON.stringify(snapshot)}\n` : formatHealth(snapshot));
    return 0;
  } catch {
    const unavailable: HealthSnapshot = { patch: null, status: "UNAVAILABLE", datasetState: "dataset_warming", runStatus: "UNAVAILABLE", stage: "catalog", dataAge: null, counters: { matchesDiscovered: 0, matchesIngested: 0, observationsAccepted: 0, observationsRejected: 0 }, unknownItemCount: 0, errorCategory: "database_unavailable" };
    write(options.json ? `${JSON.stringify(unavailable)}\n` : formatHealth(unavailable));
    return 1;
  } finally {
    if (owned) await database?.close().catch(() => undefined);
  }
}

function publicErrorCategory(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { category?: unknown; code?: unknown };
  const category = record.category ?? record.code;
  if (typeof category !== "string") return null;
  const mapped: Record<string, string> = { AUTH_FAILED: "auth", VALIDATION_FAILED: "invariant", INVARIANT_FAILED: "invariant", TRANSIENT_EXHAUSTED: "exhausted_transient" };
  return mapped[category] ?? ( /^[a-z_]{1,64}$/.test(category) ? category : null);
}

function formatHealth(snapshot: HealthSnapshot): string {
  return `status=${snapshot.status} stage=${snapshot.stage} patch=${snapshot.patch ?? "unknown"}\n`;
}
