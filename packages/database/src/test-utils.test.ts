import { describe, expect, it, vi } from "vitest";
import { createMigratedTestDatabase, type TestDatabaseDependencies } from "./test-utils";

const uuid = "123e4567-e89b-12d3-a456-426614174000";
const target = "lol_test_123_123e4567e89b12d3a456426614174000";

function fakeDependencies(options: {
  migrate?: () => Promise<void>;
  createError?: Error;
  throwOnTestClient?: Error;
  migrationEndError?: Error;
  testEndError?: Error;
  terminateError?: Error;
  dropError?: Error;
  adminEndError?: Error;
} = {}) {
  const operations: string[] = [];
  const clients: Record<string, { unsafe: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }> = {};
  const postgres = vi.fn((_url: string, { max }: { max: number }) => {
    const name = max === 1 && !clients.admin ? "admin" : max === 1 ? "migration" : "test";
    if (name === "test") {
      operations.push("CLIENT_TEST");
      if (options.throwOnTestClient) throw options.throwOnTestClient;
    }
    const client = {
      unsafe: vi.fn(async (query: string) => {
        if (name === "admin" && query.startsWith("CREATE DATABASE")) operations.push("CREATE");
        else if (name === "admin" && query.startsWith("SELECT pg_terminate")) {
          operations.push("TERMINATE");
          if (options.terminateError) throw options.terminateError;
        } else if (name === "admin" && query.startsWith("DROP DATABASE")) {
          operations.push("DROP");
          if (options.dropError) throw options.dropError;
        }
        if (name === "admin" && query.startsWith("CREATE DATABASE") && options.createError) throw options.createError;
        return [];
      }),
      end: vi.fn(async () => {
        operations.push(`END_${name}`);
        const error = name === "admin" ? options.adminEndError : name === "migration" ? options.migrationEndError : options.testEndError;
        if (error) throw error;
      })
    };
    clients[name] = client;
    return client;
  });
  const deps: TestDatabaseDependencies = {
    postgres,
    drizzle: vi.fn(() => ({ fake: true }) as never),
    migrate: vi.fn(async () => {
      operations.push("MIGRATE");
      await options.migrate?.();
    }),
    processId: 123,
    randomUUID: () => uuid
  };
  return { deps, operations, clients };
}

describe("createMigratedTestDatabase resource safety", () => {
  it("preserves migration errors and cleans in deterministic order", async () => {
    const migrationError = new Error("migration failed");
    const terminateError = new Error("terminate failed");
    const { deps, operations, clients } = fakeDependencies({
      migrate: async () => { throw migrationError; },
      terminateError
    });

    await expect(createMigratedTestDatabase("postgres://localhost/source", deps)).rejects.toBe(migrationError);
    expect(operations).toEqual(["CREATE", "MIGRATE", "END_migration", "TERMINATE", "DROP", "END_admin"]);
    expect(clients.migration!.end).toHaveBeenCalledTimes(1);
    expect(clients.admin!.end).toHaveBeenCalledTimes(1);
    expect((migrationError as Error & { cleanupError?: unknown }).cleanupError).toBe(terminateError);
  });

  it("does not drop a target when CREATE DATABASE did not succeed", async () => {
    const createError = new Error("create failed");
    const { deps, operations, clients } = fakeDependencies({ createError });

    await expect(createMigratedTestDatabase("postgres://localhost/source", deps)).rejects.toBe(createError);
    expect(operations).toEqual(["CREATE", "END_admin"]);
    expect(clients.admin!.unsafe).not.toHaveBeenCalledWith(expect.stringContaining("DROP DATABASE"));
  });

  it("does not end a migration connection twice when its first end throws", async () => {
    const migrationEndError = new Error("migration close failed");
    const { deps, operations, clients } = fakeDependencies({ migrationEndError });

    await expect(createMigratedTestDatabase("postgres://localhost/source", deps)).rejects.toBe(migrationEndError);
    expect(operations).toEqual(["CREATE", "MIGRATE", "END_migration", "TERMINATE", "DROP", "END_admin"]);
    expect(clients.migration!.end).toHaveBeenCalledTimes(1);
  });

  it("preserves test-client construction errors while dropping the owned database", async () => {
    const testClientError = new Error("test client failed");
    const { deps, operations, clients } = fakeDependencies({ throwOnTestClient: testClientError });

    await expect(createMigratedTestDatabase("postgres://localhost/source", deps)).rejects.toBe(testClientError);
    expect(operations).toEqual(["CREATE", "MIGRATE", "END_migration", "CLIENT_TEST", "TERMINATE", "DROP", "END_admin"]);
    expect(clients.migration!.end).toHaveBeenCalledTimes(1);
  });

  it("makes concurrent close calls share one cleanup and attempts every step", async () => {
    const testEndError = new Error("test close failed");
    const terminateError = new Error("terminate failed");
    const dropError = new Error("drop failed");
    const adminEndError = new Error("admin close failed");
    const { deps, operations, clients } = fakeDependencies({ testEndError, terminateError, dropError, adminEndError });
    const database = await createMigratedTestDatabase("postgres://localhost/source", deps);
    const first = database.close();
    const second = database.close();

    expect(first).toBe(second);
    await expect(first).rejects.toMatchObject({ errors: [testEndError, terminateError, dropError, adminEndError] });
    await expect(second).rejects.toBeInstanceOf(AggregateError);
    expect(operations).toEqual(["CREATE", "MIGRATE", "END_migration", "CLIENT_TEST", "END_test", "TERMINATE", "DROP", "END_admin"]);
    expect(clients.admin!.end).toHaveBeenCalledTimes(1);
    expect(clients.test!.end).toHaveBeenCalledTimes(1);
    expect(clients.migration!.end).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed UUIDs before opening or dropping any database", async () => {
    const { deps, operations } = fakeDependencies();
    deps.randomUUID = () => "abc-def";

    await expect(createMigratedTestDatabase("postgres://localhost/source", deps)).rejects.toThrow("Invalid test database name");
    expect(operations).toEqual([]);
  });

  it("rejects a source URL that names the generated target", async () => {
    const { deps, operations } = fakeDependencies();

    await expect(createMigratedTestDatabase(`postgres://localhost/${target}`, deps)).rejects.toThrow("source database");
    expect(operations).toEqual([]);
  });
});
