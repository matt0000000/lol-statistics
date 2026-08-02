# Task 2 report: sanitized terminal diagnostic code

## Implementation

Added strict terminal diagnostic extraction to `runCollection`. The extractor walks an error's `cause` chain with cycle protection and returns the first `code` matching `^[A-Z0-9_]{1,64}$`. `collection_failed` receives `diagnosticCode` only when such a code exists, with no message or exception payload. Added `diagnosticCode` to the structured logger allowlist so the sanitized value survives output while private/secret fields remain excluded.

## RED/GREEN evidence

- RED: `bunx vitest run apps/collector/src/pipeline.test.ts apps/collector/src/logger.test.ts` — 2 new tests failed as expected: the terminal event lacked `diagnosticCode`, and the logger allowlist dropped it; the 6 pre-existing tests passed.
- GREEN: `bunx vitest run apps/collector/src/pipeline.test.ts apps/collector/src/logger.test.ts` — 2 files passed, 8 tests passed.
- Collector suite: `bunx vitest run apps/collector/src` — 10 files passed, 2 skipped; 59 passed, 20 skipped.
- Typecheck: `bunx tsc --noEmit -p apps/collector/tsconfig.json` — passed.
- Diff check: `git diff --check` — passed.

## Files changed

- `apps/collector/src/pipeline.test.ts`
- `apps/collector/src/pipeline.ts`
- `apps/collector/src/logger.test.ts`
- `apps/collector/src/logger.ts`

## Self-review

The extraction is bounded to object nodes, tracks visited nodes to terminate cyclic causes, and never logs the original error, message, or nested fields. Invalid/lowercase/private codes are omitted by the extractor and non-allowlisted logger keys are dropped. Existing failure classification and persistence behavior remain unchanged.

## Concerns

No known blockers. Full PostgreSQL-backed collection execution was not attempted; focused diagnostics tests, the collector suite, and collector typecheck pass.
