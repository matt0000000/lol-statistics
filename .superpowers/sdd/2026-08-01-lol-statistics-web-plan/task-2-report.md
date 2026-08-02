# Task 2 report: HTTP API routes, error semantics, and caching

Implemented the five read-only Next.js API endpoints with injectable route handlers and production read-only wiring.

## Files

- `apps/web/app/api/{meta,champions,champions/[championId],champions/[championId]/roles/[role]/stats,methodology}/route.ts`
- `apps/web/lib/{api-errors,api-routes,http-cache,route-factory}.ts`
- `apps/web/tests/api-routes.test.ts`
- `apps/web/package.json`, `bun.lock`
- `packages/database/package.json` (client-only export for production bundling)
- `packages/public-api/src/queries.ts`

## Implementation

- Strictly validates canonical positive safe-integer champion IDs, exact roles, allowlisted stats values, bounded search, duplicate/unknown parameters, malformed escapes, control characters, and encoded path segments.
- Uses an injectable `createRouteHandlers(PublicQueries)` core for offline tests; production handlers lazily create one `DATABASE_READ_URL` pool through validated web configuration and never connect at module import or create a pool per request.
- Maps public query errors to structured 404/503 responses and all validation/upstream failures to safe 400/500 bodies. Errors use `no-store` and warming includes `Retry-After: 300`.
- Validates every outgoing response with the public Zod contracts, preventing private fields or raw exceptions from crossing the boundary.
- Adds deterministic strong publication-scoped ETags (publication ID is carried as a non-enumerable server-only scope marker), comma/weak `If-None-Match` handling, 304 empty responses, cache policy, Vary, and security headers. Methodology is not assigned an unsafe global ETag.
- Stats defaults are `items`, `adjusted`, and `includeLowConfidence=false`; role is always explicit.

## Verification

- `bunx vitest run apps/web/tests/api-routes.test.ts` — 9 passed.
- `bun run typecheck` — all workspace packages passed.
- `bun install --lockfile-only` — lockfile updated for the database workspace dependency.
- `git diff --check` — passed.
- `bun --filter @lol/web build` — compilation succeeded, but Next 16.2.12's type-check worker is incompatible with the repository's TypeScript 7.0.2 (`TypeScript 7.0.2 does not provide the compiler API required by Next.js`).

## Remaining limitation

Database-backed integration tests were not run because no PostgreSQL service is available in this environment; route tests are fully offline with fake public queries.
