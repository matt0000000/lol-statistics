import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseBrand = new WeakSet<object>();
export type Database = { db: ReturnType<typeof drizzle>; close: () => Promise<unknown> };

export function createDatabase(url: string) {
  const sql = postgres(url, { max: 10 });
  const database = { db: drizzle(sql, { schema }), close: () => sql.end() };
  databaseBrand.add(database);
  return database;
}

export function assertDatabase(value: unknown): asserts value is Database {
  if (!value || typeof value !== "object" || !databaseBrand.has(value)) throw new TypeError("database must be created by createDatabase");
}
