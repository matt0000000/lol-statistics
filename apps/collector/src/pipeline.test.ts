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

  it("returns a completed run with its active publication without rerunning stages", async () => {
    const completed = harness();
    const handlers = completed.handlers;
    (completed.dependencies.runs.resumeOrCreate as any).mockResolvedValue({ ...completed.run, status: "COMPLETED", publicationId: "pub-1" });
    (completed.dependencies.runs.isActivePublication as any) = vi.fn(async () => true);
    await expect(runCollection(completed.dependencies)).resolves.toBe("run-1");
    expect(completed.dependencies.runs.markRunning).not.toHaveBeenCalled();
    expect(handlers.CATALOG).not.toHaveBeenCalled();
  });

  it("classifies wrapped Riot failures through their safe cause", () => {
    expect(exitCodeForError(new Error("wrapped", { cause: { category: "auth", status: 403 } }))).toBe(2);
    expect(exitCodeForError(new Error("wrapped", { cause: { category: "rate_limit" } }))).toBe(4);
  });
});
