import { createDatabase } from "@lol/database";
import { DataDragonClient, syncCatalog } from "@lol/item-catalog";
import { readCollectorConfig } from "../config";

let database: ReturnType<typeof createDatabase> | undefined;

try {
  const config = readCollectorConfig(process.env);
  database = createDatabase(config.databaseUrl);
  const catalog = await new DataDragonClient().fetchTrCatalog();
  const result = await syncCatalog(database, catalog);
  console.log(`Catalog synchronized: ${result.champions} champions, ${result.items} items`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Catalog synchronization failed";
  console.error(`Catalog synchronization failed: ${message}`);
  process.exitCode = 1;
} finally {
  await database?.close();
}
