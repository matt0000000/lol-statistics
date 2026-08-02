import { describe, expect, it, vi } from "vitest";
import { COLLECTION_STAGES, exitCodeForError, runCollection } from "./pipeline";

type Run = { id: string; status: string; stage: string; patchId?: number; coverageDays?: number; minimumSample?: number };

function harness(options: { failAfter?: number } = {}) {
  let run: Run = { id: "run-1", status: "PENDING", stage: "CATALOG", patchId: 7, coverageDays: 35, minimumSample: 100 };
  const completed = new Set<string>();
  let fetched = 0;
  let publications = 0;
  const handlers = Object.fromEntries(COLLECTION_STAGES.map((stage) => [stage, vi.fn(async () => {
    if (stage === "MATCHES") {
      if (fetched < 2) fetched = 2;
      if (options.failAfter && fetched >= options.failAfter) {
        options.failAfter = undefined;
        throw new Error("injected fetch failure");
      }
    }
    if (stage === "PUBLISH") publications += 1;
  })])) as any;
  const dependencies = {
    runs: {
      resumeOrCreate: vi.fn(async () => run),
      isStageComplete: vi.fn(async (_id: string, stage: string) => completed.has(stage)),
      completeStage: vi.fn(async (_id: string, stage: string) => { completed.add(stage); run = { ...run, stage, status: stage === "PUBLISH" ? "COMPLETED" : "RUNNING" }; }),
      markRunning: vi.fn(async () => { run = { ...run, status: "RUNNING" }; }),
      markFailed: vi.fn(async (_id: string, _category: string) => { run = { ...run, status: "FAILED" }; })
    },
    stageHandlers: handlers,
    advisoryLock: { withLock: async <T>(fn: () => Promise<T>) => fn() }
  } as any;
  return { dependencies, handlers, get run() { return run; }, fetched: () => fetched, publications: () => publications };
}

describe("resumable collection pipeline", () => {
  it("resumes after a fetch-stage crash and publishes exactly once", async () => {
    const first = harness({ failAfter: 2 });
    await expect(runCollection(first.dependencies)).rejects.toThrow("injected fetch failure");
    expect(first.run.status).toBe("FAILED");
    const second = harness();
    // Reuse persisted run state and completed stages from first invocation.
    (second.dependencies.runs.resumeOrCreate as any).mockResolvedValue(first.run);
    (second.dependencies.runs.isStageComplete as any).mockImplementation(async (_id: string, stage: string) => stage === "CATALOG" || stage === "LADDER" || stage === "DISCOVERY");
    await runCollection(second.dependencies);
    expect(second.handlers.CATALOG).not.toHaveBeenCalled();
    expect(second.publications()).toBe(1);
  });

  it("maps public failure categories to scheduler exit codes", () => {
    expect(exitCodeForError({ category: "auth" })).toBe(2);
    expect(exitCodeForError({ category: "invariant" })).toBe(3);
    expect(exitCodeForError({ category: "exhausted_transient" })).toBe(4);
    expect(exitCodeForError(new Error("unknown"))).toBe(1);
  });

  it("fails closed if a completed run is ever returned by a scheduler repository", async () => {
    const completed = harness();
    const handlers = completed.handlers;
    (completed.dependencies.runs.resumeOrCreate as any).mockResolvedValue({ ...completed.run, status: "COMPLETED", publicationId: "pub-1" });
    (completed.dependencies.runs.isActivePublication as any) = vi.fn(async () => true);
    await expect(runCollection(completed.dependencies)).rejects.toMatchObject({ invariant: true });
    expect(completed.dependencies.runs.markRunning).not.toHaveBeenCalled();
    expect(handlers.CATALOG).not.toHaveBeenCalled();
  });

  it("classifies wrapped Riot failures through their safe cause", () => {
    expect(exitCodeForError(new Error("wrapped", { cause: { category: "auth", status: 403 } }))).toBe(2);
    expect(exitCodeForError(new Error("wrapped", { cause: { category: "rate_limit" } }))).toBe(4);
  });

  it("includes a sanitized diagnostic code from a wrapped terminal failure", async () => {
    const current = harness();
    const logger = { error: vi.fn() };
    current.dependencies.logger = logger;
    current.handlers.CATALOG.mockImplementation(async () => {
      throw new Error("outer wrapper", { cause: { code: "57014" } });
    });

    await expect(runCollection(current.dependencies)).rejects.toThrow("outer wrapper");
    expect(logger.error).toHaveBeenCalledWith({
      event: "collection_failed",
      runId: "run-1",
      stage: "CATALOG",
      category: "unknown",
      diagnosticCode: "57014"
    });
  });

  it("preserves the original stage failure when terminal logging throws", async () => {
    const current = harness();
    const original = Object.assign(new Error("original stage failure"), {
      category: "auth",
      status: 401,
      code: "AUTH_FAILURE"
    });
    current.dependencies.logger = { error: () => { throw new Error("logger unavailable"); } };
    current.handlers.CATALOG.mockRejectedValueOnce(original);

    await expect(runCollection(current.dependencies)).rejects.toBe(original);
    expect(current.dependencies.runs.markFailed).toHaveBeenCalledWith(
      "run-1",
      "auth",
      { type: "Error", status: 401, code: "AUTH_FAILURE" },
      "CATALOG"
    );
  });

  it("omits invalid cause codes and safely handles cyclic causes", async () => {
    const current = harness();
    const logger = { error: vi.fn() };
    const cause: { code: string; cause?: unknown } = { code: "lowercase", cause: undefined };
    cause.cause = cause;
    const original = new Error("cyclic failure", { cause });
    current.dependencies.logger = logger;
    current.handlers.CATALOG.mockRejectedValueOnce(original);

    await expect(runCollection(current.dependencies)).rejects.toBe(original);
    expect(logger.error).toHaveBeenCalledWith({
      event: "collection_failed",
      runId: "run-1",
      stage: "CATALOG",
      category: "unknown"
    });
  });

  it("resolves the current patch before selecting a resumable run", async () => {
    const events: string[] = [];
    const current = harness();
    (current.dependencies.runs.resumeOrCreate as any).mockImplementation(async () => { events.push("resume"); return current.run; });
    (current.dependencies as any).resolvePatchId = vi.fn(async () => { events.push("patch-preflight"); return 8; });
    await runCollection(current.dependencies);
    expect(events[0]).toBe("patch-preflight");
    expect((current.dependencies as any).resolvePatchId).toHaveBeenCalledOnce();
  });
});
