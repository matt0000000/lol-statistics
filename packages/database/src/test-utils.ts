import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { randomUUID as nodeRandomUUID } from "node:crypto";
import * as schema from "./schema";

const TEST_DATABASE_PREFIX = "lol_test_";
const TEST_DATABASE_NAME_PATTERN = /^lol_test_[0-9]+_[0-9a-f]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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
  if (!TEST_DATABASE_NAME_PATTERN.test(name)) throw new Error("Invalid test database name");
  return `"${name}"`;
}

function sourceDatabaseName(sourceUrl: URL): string {
  let pathname: string;
  try {
    pathname = decodeURIComponent(sourceUrl.pathname);
  } catch {
    throw new Error("Invalid source database name");
  }
  return pathname.replace(/^\//, "");
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
  const rawUuid = dependencies.randomUUID();
  if (!UUID_PATTERN.test(rawUuid)) throw new Error("Invalid test database name");
  const databaseName = `${TEST_DATABASE_PREFIX}${dependencies.processId}_${rawUuid.replaceAll("-", "")}`;
  const quotedName = quoteDatabaseName(databaseName);
  const sourceName = sourceDatabaseName(sourceUrl);
  if (sourceName === databaseName) throw new Error("Generated test database must differ from source database");
  const isolatedUrl = new URL(sourceUrl.toString());
  isolatedUrl.pathname = `/${databaseName}`;

  type ConnectionState = { client: SqlClient; endAttempted: boolean };
  const adminState: ConnectionState = { client: dependencies.postgres(sourceUrl.toString(), { max: 1 }), endAttempted: false };
  let migrationState: ConnectionState | undefined;
  let testState: ConnectionState | undefined;
  let ownsDatabase = false;
  let dropped = false;

  const endClient = async (state: ConnectionState | undefined, errors: unknown[]) => {
    if (!state || state.endAttempted) return;
    state.endAttempted = true;
    try {
      await state.client.end();
    } catch (error) {
      errors.push(error);
    }
  };

  const dropDatabase = async (errors: unknown[]) => {
    if (dropped || !ownsDatabase || !TEST_DATABASE_NAME_PATTERN.test(databaseName) || sourceName === databaseName) return;
    await endClient(testState, errors);
    await endClient(migrationState, errors);
    try {
      await adminState.client.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`
      );
    } catch (error) {
      errors.push(error);
    }
    try {
      await adminState.client.unsafe(`DROP DATABASE ${quotedName}`);
      dropped = true;
    } catch (error) {
      errors.push(error);
    }
  };

  try {
    await adminState.client.unsafe(`CREATE DATABASE ${quotedName}`);
    ownsDatabase = true;
    migrationState = { client: dependencies.postgres(isolatedUrl.toString(), { max: 1 }), endAttempted: false };
    await dependencies.migrate(dependencies.drizzle(migrationState.client), { migrationsFolder: MIGRATIONS_FOLDER });
    const migrationCloseErrors: unknown[] = [];
    await endClient(migrationState, migrationCloseErrors);
    if (migrationCloseErrors.length > 0) throw migrationCloseErrors[0];
    testState = { client: dependencies.postgres(isolatedUrl.toString(), { max: 4 }), endAttempted: false };
    let closePromise: Promise<void> | undefined;
    const closeDatabase = async () => {
      const errors: unknown[] = [];
      try {
        await dropDatabase(errors);
      } finally {
        await endClient(adminState, errors);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Test database close failed");
    };
    const database = {
      db: dependencies.drizzle(testState.client),
      close: () => {
        if (closePromise) return closePromise;
        closePromise = closeDatabase();
        return closePromise;
      }
    };
    return database;
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await dropDatabase(cleanupErrors);
    } finally {
      await endClient(adminState, cleanupErrors);
    }
    attachCleanupError(error, cleanupErrors);
    throw error;
  }
}
