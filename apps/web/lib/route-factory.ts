// Import the client entry directly: the database package's convenience index
// also exports test utilities that reference migration files unavailable to a
// production Next bundle.
import { createDatabase } from "@lol/database/src/client";
import { createPublicQueries, type PublicQueries } from "@lol/public-api";
import { readWebConfig } from "./web-config";
import { createRouteHandlers } from "./api-routes";

const CACHE_KEY = Symbol.for("lol.web.route-factory");
type CacheEntry = {
  queries: PublicQueries;
  handlers: ReturnType<typeof createRouteHandlers>;
  close: () => Promise<unknown>;
  closed: boolean;
  closePromise?: Promise<unknown>;
};
type GlobalWithCache = typeof globalThis & { [CACHE_KEY]?: CacheEntry };

/** Lazily constructs one read-only pool for the Next process. */
export function productionRouteHandlers(): ReturnType<typeof createRouteHandlers> {
  const global = globalThis as GlobalWithCache;
  if (global[CACHE_KEY] && !global[CACHE_KEY]!.closed) return global[CACHE_KEY]!.handlers;
  const config = readWebConfig(process.env as Record<string, string | undefined>);
  const database = createDatabase(config.databaseReadUrl, { max: 10 });
  const queries: PublicQueries = createPublicQueries(database.db);
  const entry: CacheEntry = { queries, handlers: createRouteHandlers(queries), close: database.close, closed: false };
  global[CACHE_KEY] = entry;
  return entry.handlers;
}

/** Shared read-only query repository used by both API routes and server pages. */
export function productionPublicQueries(): PublicQueries {
  const global = globalThis as GlobalWithCache;
  if (!global[CACHE_KEY] || global[CACHE_KEY]!.closed) productionRouteHandlers();
  return (global[CACHE_KEY] as CacheEntry).queries;
}

/** Close the singleton pool once (tests and graceful shutdown). */
export async function disposeProductionRouteHandlers(): Promise<void> {
  const global = globalThis as GlobalWithCache;
  const entry = global[CACHE_KEY];
  if (!entry) return;
  // A second disposer must await the exact same close operation. This also
  // keeps a rejected close from being retried concurrently.
  if (entry.closePromise) {
    await entry.closePromise;
    return;
  }

  entry.closed = true;
  entry.closePromise = Promise.resolve()
    .then(() => entry.close())
    .finally(() => {
      // A new entry may have been installed while the old pool was closing;
      // never remove that replacement.
      if (global[CACHE_KEY] === entry) delete global[CACHE_KEY];
    });
  await entry.closePromise;
}

// Short alias for callers that do not need to distinguish production wiring
// from test-created route handlers.
export const disposeRouteHandlers = disposeProductionRouteHandlers;
