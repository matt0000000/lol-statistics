import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDatabase } = vi.hoisted(() => ({ createDatabase: vi.fn() }));
vi.mock("@lol/database/src/client", () => ({ createDatabase }));
vi.mock("./web-config", () => ({ readWebConfig: () => ({ databaseReadUrl: "postgres://test" }) }));

import { disposeProductionRouteHandlers, productionRouteHandlers } from "./route-factory";

const CACHE_KEY = Symbol.for("lol.web.route-factory");
type Entry = { handlers: unknown; close: () => Promise<unknown>; closed: boolean; closePromise?: Promise<unknown> };
const globalCache = globalThis as typeof globalThis & { [CACHE_KEY]?: Entry };

function database(close: () => Promise<unknown>) {
  return { db: { execute: vi.fn(async () => []) }, close };
}

describe("production route handler lifecycle", () => {
  beforeEach(async () => {
    // Ensure a previous test's entry is not retained across test cases.
    try { await disposeProductionRouteHandlers(); } catch { /* close rejection is tested explicitly */ }
    delete globalCache[CACHE_KEY];
    createDatabase.mockReset();
  });

  it("does not delete a replacement while the original pool is closing", async () => {
    let releaseA!: () => void;
    const closeA = vi.fn(() => new Promise<void>((resolve) => { releaseA = resolve; }));
    const closeB = vi.fn(async () => undefined);
    createDatabase.mockReturnValueOnce(database(closeA)).mockReturnValueOnce(database(closeB));

    const handlersA = productionRouteHandlers();
    const disposingA = disposeProductionRouteHandlers();
    await Promise.resolve();
    expect(closeA).toHaveBeenCalledTimes(1);

    const handlersB = productionRouteHandlers();
    expect(handlersB).not.toBe(handlersA);
    releaseA();
    await disposingA;
    expect(globalCache[CACHE_KEY]?.handlers).toBe(handlersB);

    await disposeProductionRouteHandlers();
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(globalCache[CACHE_KEY]).toBeUndefined();
  });

  it("shares one close promise across concurrent disposers and recreates after rejection", async () => {
    const closeError = new Error("close failed");
    const closeA = vi.fn(async () => { throw closeError; });
    const closeB = vi.fn(async () => undefined);
    createDatabase.mockReturnValueOnce(database(closeA)).mockReturnValueOnce(database(closeB));
    productionRouteHandlers();

    const first = disposeProductionRouteHandlers();
    const second = disposeProductionRouteHandlers();
    await expect(first).rejects.toBe(closeError);
    await expect(second).rejects.toBe(closeError);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(globalCache[CACHE_KEY]).toBeUndefined();

    productionRouteHandlers();
    expect(createDatabase).toHaveBeenCalledTimes(2);
    await disposeProductionRouteHandlers();
    expect(closeB).toHaveBeenCalledTimes(1);
  });

  it("initializes one pool for synchronous concurrent callers", () => {
    const close = vi.fn(async () => undefined);
    createDatabase.mockReturnValue(database(close));
    const first = productionRouteHandlers();
    const second = productionRouteHandlers();
    expect(second).toBe(first);
    expect(createDatabase).toHaveBeenCalledTimes(1);
  });
});
