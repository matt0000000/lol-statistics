import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import * as schema from "./schema";

const TEST_DATABASE_PREFIX = "lol_test_";

function quoteDatabaseName(name: string): string {
  if (!/^lol_test_[a-z0-9_]+$/.test(name)) throw new Error("Invalid test database name");
  return `"${name}"`;
}

/** Create an isolated disposable database and apply every checked-in migration. */
export async function createMigratedTestDatabase(url: string) {
  const sourceUrl = new URL(url);
  const databaseName = `${TEST_DATABASE_PREFIX}${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const quotedName = quoteDatabaseName(databaseName);
  const adminSql = postgres(sourceUrl.toString(), { max: 1 });
  try {
    await adminSql.unsafe(`CREATE DATABASE ${quotedName}`);
    const isolatedUrl = new URL(sourceUrl.toString());
    isolatedUrl.pathname = `/${databaseName}`;
    const migrationSql = postgres(isolatedUrl.toString(), { max: 1 });
    await migrate(drizzle(migrationSql), {
      migrationsFolder: new URL("../../../migrations", import.meta.url).pathname
    });
    await migrationSql.end();

    const sql = postgres(isolatedUrl.toString(), { max: 4 });
    return {
      db: drizzle(sql, { schema }),
      close: async () => {
        await sql.end();
        await adminSql.unsafe(`DROP DATABASE ${quotedName}`);
        await adminSql.end();
      }
    };
  } catch (error) {
    await adminSql.end();
    throw error;
  }
}
