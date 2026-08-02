// Import the client entry directly: the database package's convenience index
// also exports test utilities that reference migration files unavailable to a
// production Next bundle.
import { createDatabase } from "@lol/database/src/client";
import { createPublicQueries, type PublicQueries } from "@lol/public-api";
import { readWebConfig } from "./web-config";
import { createRouteHandlers } from "./api-routes";

const CACHE_KEY = Symbol.for("lol.web.route-factory");
type CacheEntry = { handlers: ReturnType<typeof createRouteHandlers>; close: () => Promise<unknown>; closed: boolean };
type GlobalWithCache = typeof globalThis & { [CACHE_KEY]?: CacheEntry };

/** Lazily constructs one read-only pool for the Next process. */
export function productionRouteHandlers(): ReturnType<typeof createRouteHandlers> {
  const global = globalThis as GlobalWithCache;
  if (global[CACHE_KEY] && !global[CACHE_KEY]!.closed) return global[CACHE_KEY]!.handlers;
  const config = readWebConfig(process.env as Record<string, string | undefined>);
  const database = createDatabase(config.databaseReadUrl, { max: 10 });
  const queries: PublicQueries = createPublicQueries(database.db);
  const entry: CacheEntry = { handlers: createRouteHandlers(queries), close: database.close, closed: false };
  global[CACHE_KEY] = entry;
  return entry.handlers;
}

/** Close the singleton pool once (tests and graceful shutdown). */
export async function disposeProductionRouteHandlers(): Promise<void> {
  const global = globalThis as GlobalWithCache;
  const entry = global[CACHE_KEY];
  if (!entry || entry.closed) return;
  entry.closed = true;
  await entry.close();
  delete global[CACHE_KEY];
}

// Short alias for callers that do not need to distinguish production wiring
// from test-created route handlers.
export const disposeRouteHandlers = disposeProductionRouteHandlers;
