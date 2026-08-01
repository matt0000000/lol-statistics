import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseBrand = new WeakSet<object>();
export type Database = { db: ReturnType<typeof drizzle>; close: () => Promise<unknown>; withAdvisoryLock?: <T>(fn: () => Promise<T>) => Promise<T> };

export type DatabaseOptions = { max?: number; connect_timeout?: number };

export function createDatabase(url: string, options: DatabaseOptions = {}): Database {
  const sql = postgres(url, { max: options.max ?? 10, ...(options.connect_timeout ? { connect_timeout: options.connect_timeout } : {}) });
  const database = {
    db: drizzle(sql, { schema }),
    close: () => sql.end(),
    withAdvisoryLock: async <T>(fn: () => Promise<T>): Promise<T> => {
      // Keep the advisory lock on a dedicated session while work uses the regular pool.
      const lockSql = postgres(url, { max: 1 });
      const acquired = await lockSql<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext('lol-statistics-collector')) as locked`;
      if (!acquired[0]?.locked) {
        await lockSql.end();
        throw Object.assign(new Error("collector scheduler overlap"), { category: "exhausted_transient" });
      }
      try {
        return await fn();
      } finally {
        try { await lockSql`select pg_advisory_unlock(hashtext('lol-statistics-collector'))`; } finally { await lockSql.end(); }
      }
    }
  };
  databaseBrand.add(database);
  return database;
}

export function assertDatabase(value: unknown): asserts value is Database {
  if (!value || typeof value !== "object" || !databaseBrand.has(value)) throw new TypeError("database must be created by createDatabase");
}
