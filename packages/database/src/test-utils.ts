import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/** Create a test connection after applying every checked-in migration. */
export async function createMigratedTestDatabase(url: string) {
  const migrationSql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(migrationSql), {
      migrationsFolder: new URL("../../../migrations", import.meta.url).pathname
    });
  } finally {
    await migrationSql.end();
  }

  const sql = postgres(url, { max: 4 });
  return { db: drizzle(sql, { schema }), close: () => sql.end() };
}
