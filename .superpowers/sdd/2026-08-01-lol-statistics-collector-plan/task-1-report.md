# Task 1 report: Riot HTTP boundary

Implemented the typed Riot HTTP client with a per-instance rate-limit gate, deterministic retries, safe URL construction, and redacted operational errors.

## Verification

- `bunx vitest run packages/riot-client/src/http.test.ts` — 9 passed.
- `bunx vitest run packages/riot-client` — 1 file, 9 passed.
- `bunx vitest run` — 9 files passed, 2 skipped; 68 passed, 6 skipped.
- `bun run typecheck` — all workspace packages passed.
- `git diff --check` — passed.

## Files

- `packages/riot-client/package.json`
- `packages/riot-client/tsconfig.json`
- `packages/riot-client/src/errors.ts`
- `packages/riot-client/src/retry.ts`
- `packages/riot-client/src/rate-limit.ts`
- `packages/riot-client/src/http.ts`
- `packages/riot-client/src/http.test.ts`
- `packages/riot-client/src/index.ts`
- Root `package.json` and `bun.lock` (Pino dependency)

## Commit

`18481ff feat: add resilient Riot HTTP client`

## Remaining concerns

The gate derives a reset interval from Riot's count/limit headers because the headers do not provide an absolute reset timestamp. Malformed buckets fail open. URL host validation permits any single or multi-label Riot API subdomain ending in `.api.riotgames.com`, covering both platform and regional routing used by later clients.
