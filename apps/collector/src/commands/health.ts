import { and, desc, eq } from "drizzle-orm";
import { aggregatePublications, collectionRuns, createDatabase, patches, participantRejections } from "@lol/database";

export type HealthOptions = { env?: Record<string, string | undefined>; json?: boolean; write?: (line: string) => void; database?: ReturnType<typeof createDatabase> };
export type HealthSnapshot = {
  patch: string | null;
  status: string;
  stage: string;
  dataAge: string | null;
  counters: { matchesDiscovered: number; matchesIngested: number; observationsAccepted: number; observationsRejected: number };
  unknownItemCount: number;
  errorCategory: string | null;
};

export async function healthCommand(options: HealthOptions = {}): Promise<number> {
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  let database = options.database;
  let owned = false;
  try {
    const url = options.env?.DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("database configuration unavailable");
    if (!database) { database = createDatabase(url, { max: 2, connect_timeout: 1 }); owned = true; }
    const [patch] = await database.db.select({ patchKey: patches.patchKey }).from(patches).where(eq(patches.isActive, true)).limit(1);
    const [run] = await database.db.select().from(collectionRuns).orderBy(desc(collectionRuns.updatedAt), desc(collectionRuns.startedAt)).limit(1);
    const unknownRows = run ? await database.db.select({ count: participantRejections.participantId }).from(participantRejections).where(and(eq(participantRejections.patchId, run.patchId ?? -1), eq(participantRejections.reason, "unknown_item"))) : [];
    const snapshot: HealthSnapshot = {
      patch: patch?.patchKey ?? null,
      status: run?.status ?? "IDLE",
      stage: run?.stage ?? "CATALOG",
      dataAge: run?.updatedAt ? new Date(run.updatedAt).toISOString() : null,
      counters: {
        matchesDiscovered: run?.matchesDiscovered ?? 0,
        matchesIngested: run?.matchesIngested ?? 0,
        observationsAccepted: run?.observationsAccepted ?? 0,
        observationsRejected: run?.observationsRejected ?? 0
      },
      unknownItemCount: unknownRows.length,
      errorCategory: publicErrorCategory(run?.errorDetails)
    };
    write(options.json ? `${JSON.stringify(snapshot)}\n` : formatHealth(snapshot));
    return 0;
  } catch {
    const unavailable: HealthSnapshot = { patch: null, status: "UNAVAILABLE", stage: "CATALOG", dataAge: null, counters: { matchesDiscovered: 0, matchesIngested: 0, observationsAccepted: 0, observationsRejected: 0 }, unknownItemCount: 0, errorCategory: "database_unavailable" };
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
