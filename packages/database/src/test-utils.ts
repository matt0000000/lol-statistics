import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { randomUUID as nodeRandomUUID } from "node:crypto";
import * as schema from "./schema";

const TEST_DATABASE_PREFIX = "lol_test_";
const MIGRATIONS_FOLDER = new URL("../../../migrations", import.meta.url).pathname;

type SqlClient = {
  unsafe: (query: string) => Promise<unknown>;
  end: (...args: unknown[]) => Promise<unknown>;
};
type TestDatabase = ReturnType<typeof import("./client").createDatabase>["db"];

export type TestDatabaseDependencies = {
  postgres: (url: string, options: { max: number }) => SqlClient;
  migrate: (database: unknown, options: { migrationsFolder: string }) => Promise<void>;
  drizzle: (sql: SqlClient) => TestDatabase;
  randomUUID: () => string;
  processId: number;
};

const defaultDependencies: TestDatabaseDependencies = {
  postgres: postgres as unknown as TestDatabaseDependencies["postgres"],
  migrate: drizzleMigrate as unknown as TestDatabaseDependencies["migrate"],
  drizzle: ((sql) => drizzlePostgres(sql as never, { schema })) as TestDatabaseDependencies["drizzle"],
  randomUUID: nodeRandomUUID,
  processId: process.pid
};

function quoteDatabaseName(name: string): string {
  if (!/^lol_test_[a-z0-9_]+$/.test(name)) throw new Error("Invalid test database name");
  return `"${name}"`;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function attachCleanupError(primary: unknown, cleanupErrors: unknown[]) {
  if (cleanupErrors.length === 0) return;
  const error = asError(primary) as Error & { cleanupError?: unknown };
  error.cleanupError = cleanupErrors.length === 1 ? cleanupErrors[0] : new AggregateError(cleanupErrors, "Test database cleanup failed");
}

/** Create an isolated disposable database and apply every checked-in migration. */
export async function createMigratedTestDatabase(
  url: string,
  injectedDependencies: Partial<TestDatabaseDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...injectedDependencies };
  const sourceUrl = new URL(url);
  const databaseName = `${TEST_DATABASE_PREFIX}${dependencies.processId}_${dependencies.randomUUID().replaceAll("-", "")}`;
  const quotedName = quoteDatabaseName(databaseName);
  const isolatedUrl = new URL(sourceUrl.toString());
  isolatedUrl.pathname = `/${databaseName}`;

  const adminSql = dependencies.postgres(sourceUrl.toString(), { max: 1 });
  let migrationSql: SqlClient | undefined;
  let testSql: SqlClient | undefined;
  let databaseCreated = false;
  let dropped = false;

  const endClient = async (client: SqlClient | undefined, errors: unknown[]) => {
    if (!client) return;
    try {
      await client.end();
    } catch (error) {
      errors.push(error);
    }
  };

  const dropDatabase = async (errors: unknown[]) => {
    if (dropped || !databaseCreated) return;
    await endClient(testSql, errors);
    await endClient(migrationSql, errors);
    try {
      await adminSql.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`
      );
    } catch (error) {
      errors.push(error);
    }
    try {
      await adminSql.unsafe(`DROP DATABASE ${quotedName}`);
      dropped = true;
    } catch (error) {
      errors.push(error);
    }
  };

  try {
    await adminSql.unsafe(`CREATE DATABASE ${quotedName}`);
    databaseCreated = true;
    migrationSql = dependencies.postgres(isolatedUrl.toString(), { max: 1 });
    await dependencies.migrate(dependencies.drizzle(migrationSql), { migrationsFolder: MIGRATIONS_FOLDER });
    const migrationCloseErrors: unknown[] = [];
    await endClient(migrationSql, migrationCloseErrors);
    if (migrationCloseErrors.length > 0) throw asError(migrationCloseErrors[0]);
    migrationSql = undefined;
    testSql = dependencies.postgres(isolatedUrl.toString(), { max: 4 });
    const database = {
      db: dependencies.drizzle(testSql),
      close: async () => {
        if (closePromise) return closePromise;
        closePromise = closeDatabase();
        return closePromise;
      }
    };
    let closePromise: Promise<void> | undefined;
    const closeDatabase = async () => {
      const errors: unknown[] = [];
      try {
        await dropDatabase(errors);
      } finally {
        await endClient(adminSql, errors);
      }
      if (errors.length === 1) throw asError(errors[0]);
      if (errors.length > 1) throw new AggregateError(errors, "Test database close failed");
    };
    return database;
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await dropDatabase(cleanupErrors);
    } finally {
      await endClient(adminSql, cleanupErrors);
    }
    attachCleanupError(error, cleanupErrors);
    throw error;
  }
}
