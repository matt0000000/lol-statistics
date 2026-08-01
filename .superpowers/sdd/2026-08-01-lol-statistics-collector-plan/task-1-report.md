# Task 1 report: Riot HTTP boundary

Implemented the typed Riot HTTP client with a per-instance rate-limit gate, deterministic retries, safe URL construction, and redacted operational errors.

## Verification

- `bunx vitest run packages/riot-client/src/http.test.ts` — 9 passed.
- `bunx vitest run packages/riot-client` — 1 file, 9 passed.
- `bunx vitest run` — 9 files passed, 2 skipped; 68 passed, 6 skipped.
- `bun run typecheck` — all workspace packages passed.
- `git diff --check` — passed.

## Fix Round 2

Implementation and regression tests are in commit `6998d3f9bee9484eb1ec58837328302f53490ea9`.

- Network retries now require the concrete native `TypeError` predicate; arbitrary marker objects, transport-code objects, DOM exceptions, and programmer errors propagate unchanged.
- URL validation rejects literal/encoded/double-encoded traversal, encoded slash/backslash, malformed percent escapes, protocol-relative paths, credential/fragment/control confusion, and canonical-path rewrites before URL construction.
- Literal, encoded, and double-encoded API-key forms are rejected in path/query input without exposing the key in errors.
- Added deterministic Retry-After fallback, jitter cap, valid multi-window app/method gating, spoof-marker, and traversal/API-key regression coverage.

Fix Round 2 verification:

- `bunx vitest run packages/riot-client/src/http.test.ts` — 27 passed.
- `bunx vitest run` — 9 files passed, 2 skipped; 86 passed, 6 skipped.
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

## Fix Round 1

Implementation and adversarial-test fixes are in commit `ed692679bff40f182bc90aac0bf012a94718e1ba`.

- Error messages are static category text and never include request-controlled path, query, host, response, or fetch-error content.
- Only recognized fetch network failures (`TypeError`, explicit `isNetworkError`, and known transport error codes) are retried; programmer and sleeper errors propagate unchanged.
- A per-client async mutex serializes rate-gated fetch attempts and releases in `finally`, including error paths.
- Rate-limit headers now require strict two-field integer buckets with matching windows; malformed, duplicate, negative, nonfinite, and extra-field values fail safe.
- Added adversarial tests for redaction, URL attacks, redirect policy, malformed `Retry-After`, retry bounds/jitter, network classification, concurrency ordering, and mutex release.

Fix Round 1 verification:

- `bunx vitest run packages/riot-client` — 16 passed.
- `bunx vitest run` — 9 files passed, 2 skipped; 75 passed, 6 skipped.
- `bun run typecheck` — all workspace packages passed.
- `git diff --check` — passed.
