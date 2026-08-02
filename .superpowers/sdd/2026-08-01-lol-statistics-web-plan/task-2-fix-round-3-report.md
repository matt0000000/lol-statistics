# Web Task 2 fix round 3: external method semantics

## Implementation summary

- Exported shared secured method responses from `apps/web/lib/api-routes.ts`: mutation methods return an empty 405 with `Allow: GET, HEAD`, `Cache-Control: no-store`, `Vary`, and the common nosniff/referrer headers.
- Added a CORS-neutral 204 `OPTIONS` response with the same capability and security headers.
- Added a shared HEAD adapter that executes the corresponding GET with a GET request and returns identical status/headers with an empty body.
- Wired explicit `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS` exports into all five public API route modules. OPTIONS handling is also consistent when calling shared handlers directly.
- Added route-module tests importing each actual route and proving mutation/OPTIONS dispatch does not initialize the database.

## RED evidence

The new route-module tests target the external method exports that were absent at the start of this fix round. No pre-implementation test output was retained in the worktree; the tests now pass against every route module.

## Verification

- `bun run test` — authoritative Vitest workspace suite passed.
- `bun run typecheck` — all workspace packages passed.
- `bun --filter @lol/web build` — Next.js 16 production build passed.
- Built-server smoke test with bounded readiness and cleanup: POST to all five endpoints returned `405`; `OPTIONS /api/meta` returned `204`; `HEAD /api/meta` returned `500` because no PostgreSQL server is available, while exercising the GET path (and did not incorrectly return `405`).
- Built-server response headers for 405/204 included `Allow: GET, HEAD`, `Cache-Control: no-store`, `Vary`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`; OPTIONS emitted no CORS allow-origin header.
- PostgreSQL/database checks: no local PostgreSQL server is available; no migration/schema changes were made.
- `git diff --check` — passed.

## Residual risk

HEAD status/body parity with successful GET responses requires a reachable configured database; the local smoke test could only verify the no-database GET failure path and that HEAD was not misclassified as 405.
