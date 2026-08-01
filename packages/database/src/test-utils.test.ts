import { describe, expect, it, vi } from "vitest";
import { createMigratedTestDatabase, type TestDatabaseDependencies } from "./test-utils";

function fakeDependencies(overrides: Partial<TestDatabaseDependencies> = {}) {
  const clients: Array<{ unsafe: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }> = [];
  const createSql = vi.fn(() => {
    const client = { unsafe: vi.fn(async () => []), end: vi.fn(async () => undefined) };
    clients.push(client);
    return client;
  });
  const deps: TestDatabaseDependencies = {
    postgres: createSql,
    drizzle: vi.fn(() => ({ fake: true }) as never),
    migrate: vi.fn(async () => undefined),
    processId: 123,
    randomUUID: () => "abc-def",
    ...overrides
  };
  return { deps, clients, createSql };
}

describe("createMigratedTestDatabase resource safety", () => {
  it("cleans migration/admin resources and drops the database while preserving setup errors", async () => {
    const setupError = new Error("migration failed");
    const { deps, clients } = fakeDependencies({ migrate: vi.fn(async () => { throw setupError; }) });

    await expect(createMigratedTestDatabase("postgres://localhost/source", deps)).rejects.toBe(setupError);

    expect(clients).toHaveLength(2);
    expect(clients[0]!.end).toHaveBeenCalledOnce();
    expect(clients[1]!.end).toHaveBeenCalledOnce();
    expect(clients[0]!.unsafe).toHaveBeenCalledWith(expect.stringContaining("DROP DATABASE \"lol_test_123_abcdef\""));
  });

  it("makes close idempotent and always ends admin even when cleanup fails", async () => {
    const { deps, clients } = fakeDependencies();
    const database = await createMigratedTestDatabase("postgres://localhost/source", deps);
    clients[2]!.end.mockRejectedValueOnce(new Error("test connection close failed"));

    const firstClose = database.close();
    const secondClose = database.close();
    await expect(firstClose).rejects.toThrow("test connection close failed");
    await expect(secondClose).rejects.toThrow("test connection close failed");

    expect(clients[0]!.end).toHaveBeenCalledOnce();
    expect(clients[2]!.end).toHaveBeenCalledOnce();
    expect(clients[0]!.unsafe).toHaveBeenCalledWith(expect.stringContaining("DROP DATABASE \"lol_test_123_abcdef\""));
  });
});
