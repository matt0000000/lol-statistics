import { describe, expect, it } from "vitest";
import { createMigratedTestDatabase, CollectionRunRepository } from "@lol/database";
import { COLLECTION_STAGES, runCollection } from "./pipeline";

const configured = Boolean(process.env.TEST_DATABASE_URL);
const suite = configured ? describe : describe.skip;

suite("collector pipeline PostgreSQL persistence", () => {
  it("persists stage advancement and resumes without rerunning completed stages", async () => {
    const isolated = await createMigratedTestDatabase(process.env.TEST_DATABASE_URL!);
    try {
      const runs = new CollectionRunRepository(isolated.db);
      const calls = new Map<string, number>();
      const stageHandlers = Object.fromEntries(COLLECTION_STAGES.map((stage) => [stage, async () => calls.set(stage, (calls.get(stage) ?? 0) + 1)])) as any;
      await runCollection({ runs: runs as any, stageHandlers });
      await runCollection({ runs: runs as any, stageHandlers });
      expect([...calls.values()].every((count) => count === 1)).toBe(true);
      const [run] = await isolated.db.select().from((await import("@lol/database")).collectionRuns).limit(1);
      expect(run?.status).toBe("COMPLETED");
      expect(run?.stage).toBe("PUBLISH");
    } finally {
      await isolated.close();
    }
  });
});
