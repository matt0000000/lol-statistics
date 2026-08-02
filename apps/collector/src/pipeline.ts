import { PublicationInvariantError } from "./services/publish";

export const COLLECTION_STAGES = [
  "CATALOG",
  "LADDER",
  "DISCOVERY",
  "MATCHES",
  "AGGREGATES",
  "VERIFY",
  "PUBLISH"
] as const;
export type CollectionStage = (typeof COLLECTION_STAGES)[number];
export type FailureCategory = "auth" | "invariant" | "exhausted_transient" | "unknown";

export type PipelineRun = {
  id: string;
  status?: string;
  stage?: string;
  patchId?: number | null;
  coverageDays?: number;
  minimumSample?: number;
  [key: string]: unknown;
};

export type PipelineDependencies = {
  runs: {
    resumeOrCreate: (input: { patchId?: number; coverageDays: number; minimumSample: number }) => Promise<PipelineRun>;
    isStageComplete: (runId: string, stage: CollectionStage) => Promise<boolean>;
    completeStage: (runId: string, stage: CollectionStage) => Promise<unknown>;
    markFailed?: (runId: string, category: FailureCategory, detail: Record<string, unknown>, stage: CollectionStage) => Promise<unknown>;
    markRunning?: (runId: string) => Promise<unknown>;
    get?: (runId: string) => Promise<PipelineRun | undefined>;
    isActivePublication?: (run: PipelineRun) => Promise<boolean>;
  };
  stageHandlers: Partial<Record<CollectionStage, (run: PipelineRun) => Promise<unknown>>> & Record<string, (run: PipelineRun) => Promise<unknown>>;
  advisoryLock?: { withLock<T>(fn: () => Promise<T>): Promise<T> } | ((fn: () => Promise<unknown>) => Promise<unknown>);
  logger?: { error?: (fields: Record<string, unknown>) => void };
  patchId?: number;
  coverageDays?: number;
  minimumSample?: number;
  resolvePatchId?: () => Promise<number | undefined>;
};

/** Runs one resumable collection. Stage completion is recorded only after the handler resolves. */
export async function runCollection(dependencies: PipelineDependencies): Promise<string> {
  const execute = async () => {
    const resolvedPatchId = dependencies.patchId ?? await dependencies.resolvePatchId?.();
    const run = await dependencies.runs.resumeOrCreate({
      patchId: resolvedPatchId,
      coverageDays: dependencies.coverageDays ?? 35,
      minimumSample: dependencies.minimumSample ?? 100
    });
    if (run.status === "COMPLETED") {
      throw Object.assign(new Error("completed collection run is immutable history"), { invariant: true });
    }
    await dependencies.runs.markRunning?.(run.id);
    let activeStage: CollectionStage = currentStage(run);
    try {
      for (const stage of COLLECTION_STAGES) {
        activeStage = stage;
        if (await dependencies.runs.isStageComplete(run.id, stage)) continue;
        const handler = dependencies.stageHandlers[stage];
        if (typeof handler !== "function") throw new Error(`missing collection stage handler: ${stage}`);
        const refreshed = await dependencies.runs.get?.(run.id);
        await handler(refreshed ?? run);
        await dependencies.runs.completeStage(run.id, stage);
      }
      return run.id;
    } catch (error) {
      const category = classifyFailure(error);
      const detail = privateFailureDetail(error);
      await dependencies.runs.markFailed?.(run.id, category, detail, activeStage);
      const diagnosticCode = terminalDiagnosticCode(error);
      dependencies.logger?.error?.({
        event: "collection_failed",
        runId: run.id,
        stage: activeStage,
        category,
        ...(diagnosticCode ? { diagnosticCode } : {})
      });
      throw error;
    }
  };
  return withAdvisoryLock(dependencies.advisoryLock, execute);
}

export function classifyFailure(error: unknown): FailureCategory {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof PublicationInvariantError || (typeof current === "object" && (current as { invariant?: boolean }).invariant === true)) return "invariant";
    if (typeof current === "object") {
      const candidate = current as { category?: string; status?: number; retryable?: boolean; exhausted?: boolean; cause?: unknown };
      if (candidate.category === "auth" || candidate.status === 401 || candidate.status === 403) return "auth";
      if (candidate.category === "invariant") return "invariant";
      if (candidate.category === "exhausted_transient" || candidate.exhausted === true || candidate.category === "rate_limit" || candidate.category === "server" || candidate.category === "network" || candidate.retryable === true) return "exhausted_transient";
      current = candidate.cause;
      continue;
    }
    break;
  }
  return "unknown";
}

export function exitCodeForError(error: unknown): number {
  const category = classifyFailure(error);
  return category === "auth" ? 2 : category === "invariant" ? 3 : category === "exhausted_transient" ? 4 : error ? 1 : 0;
}

function privateFailureDetail(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") return { type: typeof error };
  const candidate = error as { name?: unknown; status?: unknown; code?: unknown };
  const detail: Record<string, unknown> = { type: typeof candidate.name === "string" ? candidate.name : "Error" };
  if (typeof candidate.status === "number" && Number.isSafeInteger(candidate.status)) detail.status = candidate.status;
  if (typeof candidate.code === "string" && /^[A-Z0-9_]{1,64}$/.test(candidate.code)) detail.code = candidate.code;
  return detail;
}

function terminalDiagnosticCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current !== "object") break;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[A-Z0-9_]{1,64}$/.test(candidate.code)) return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

function currentStage(run: PipelineRun): CollectionStage {
  const stage = String(run.stage ?? "CATALOG").toUpperCase();
  return (COLLECTION_STAGES as readonly string[]).includes(stage) ? stage as CollectionStage : "CATALOG";
}

export async function withAdvisoryLock<T>(lock: PipelineDependencies["advisoryLock"], fn: () => Promise<T>): Promise<T> {
  if (!lock) return fn();
  if (typeof lock === "function") return await lock(fn) as T;
  return lock.withLock(fn);
}
