// Import the client entry directly: the database package's convenience index
// also exports test utilities that reference migration files unavailable to a
// production Next bundle.
import { createDatabase } from "@lol/database/src/client";
import { createPublicQueries, type PublicQueries } from "@lol/public-api";
import { readWebConfig } from "./web-config";
import { createRouteHandlers } from "./api-routes";

let cached: ReturnType<typeof createRouteHandlers> | undefined;

/** Lazily constructs one read-only pool for the Next process. */
export function productionRouteHandlers(): ReturnType<typeof createRouteHandlers> {
  if (cached) return cached;
  const config = readWebConfig(process.env as Record<string, string | undefined>);
  const database = createDatabase(config.databaseReadUrl, { max: 10 });
  const queries: PublicQueries = createPublicQueries(database.db);
  cached = createRouteHandlers(queries);
  return cached;
}
