import { describe, expect, it } from "vitest";
import { CollectionRunRepository } from "./collection-runs";

describe("CollectionRunRepository stage transitions", () => {
  it("rejects stage updates on terminal runs", async () => {
    const terminal = { id: "run", status: "COMPLETED", stage: "publish" };
    const db = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({ limit: async () => [terminal] })
            })
          })
        })
      })
    };
    await expect(new CollectionRunRepository(db).updateStage("run", "publish")).rejects.toThrow("not eligible");
  });
});
