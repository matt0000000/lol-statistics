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

  it("never rebinds an existing run to another patch", async () => {
    const run = { id: "run", status: "FAILED", stage: "matches", patchId: 11 };
    const db = {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({ limit: async () => [run] })
            })
          })
        }),
        update: () => { throw new Error("update must not be reached"); }
      })
    };
    await expect(new CollectionRunRepository(db).bindPatch("run", 12)).rejects.toThrow("patch is immutable");
  });

  it("allows an initial bind but returns the same immutable identity on replay", async () => {
    const runs = [{ id: "run", status: "PENDING", stage: "catalog", patchId: null }, { id: "run", status: "PENDING", stage: "catalog", patchId: 12 }];
    let updates = 0;
    const db = {
      transaction: async (fn: (tx: any) => Promise<unknown>) => fn({
        select: () => ({ from: () => ({ where: () => ({ for: () => ({ limit: async () => [runs[Math.min(updates, 1)]!] }) }) }) }),
        update: () => ({ set: () => ({ where: () => ({ returning: async () => { updates += 1; return [runs[1]]; } }) }) })
      })
    };
    await expect(new CollectionRunRepository(db).bindPatch("run", 12)).resolves.toMatchObject({ patchId: 12 });
    await expect(new CollectionRunRepository(db).bindPatch("run", 12)).resolves.toMatchObject({ patchId: 12 });
    expect(updates).toBe(1);
  });
});
