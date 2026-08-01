# Foundation broad-review fix round 1

## Changes

- Classified the 16.15 upgraded-boots ID `3172` through the versioned override map as `BOOTS`, with an explicit upgraded-boots reason; retained base-boots/component and ordinary completed-boots behavior.
- Added the production-owned version-aware alias API. `DataDragonClient` now attaches defensive aliases for known patches (`16.15 -> 7002:3031`) and returns no aliases for unknown patches. `syncCatalog` validates and passes these aliases through; the official fixture remains free of item `7002`.
- Restricted realm catalog URLs to HTTPS `ddragon.leagueoflegends.com` and preserved the CDN path when constructing catalog requests.
- Added a composite unique key on `matches(match_id, patch_id)` and a composite observation foreign key, preventing cross-patch participant rows.
- Added integration assertions for active-patch uniqueness, patch-key checks, and cross-patch observation rejection, plus static migration/schema contracts.
- Generated migration `0001_gray_golden_guardian.sql` and snapshot metadata.

## Verification

- `bunx vitest run packages/item-catalog/src/classifier.test.ts packages/item-catalog/src/client.test.ts packages/item-catalog/src/sync.integration.test.ts packages/database/src/schema.contract.test.ts packages/database/src/schema.integration.test.ts` — 30 passed, 4 skipped (database unavailable).
- `bun run test` — 39 passed, 5 skipped (database integration tests conditionally skipped without `TEST_DATABASE_URL`).
- `bun run typecheck` — all workspaces passed.
- `bun run db:generate` — no schema changes; generated migration matches Drizzle schema.
- `git diff --check` — passed.
- `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/schema.integration.test.ts packages/item-catalog/src/sync.integration.test.ts` — attempted; all database cases reached `ECONNREFUSED 127.0.0.1:5432` because PostgreSQL is unavailable in this environment.

## Residual concerns

Runtime PostgreSQL constraint and transaction assertions remain unexecuted until a disposable PostgreSQL instance is available. The integration tests are present and conditionally skip in the normal suite when no test URL is configured.

## Fix Round 2

- Tightened realm CDN validation to the canonical `https://ddragon.leagueoflegends.com/cdn` base, allowing only one trailing slash. Credentials, explicit ports, query strings, fragments, foreign paths, and non-HTTPS URLs are rejected. Catalog paths are built with `URL` and encoded path segments.
- Added a shared `createMigratedTestDatabase` helper. PostgreSQL suites now apply checked-in migrations before opening test connections, use test-owned deterministic namespaces, clean their rows after each test, and include explicit transaction rollback coverage for failed alias validation.
- Integration teardown now avoids masking connection/setup errors when PostgreSQL is unavailable.

Round 2 verification:

- `bunx vitest run packages/item-catalog/src/client.test.ts` — 22 passed.
- `bun run test` — 45 passed, 6 skipped.
- `bun run typecheck` — all workspaces passed.
- `bun run db:generate` — no schema changes.
- `git diff --check` — passed.
- `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/schema.integration.test.ts packages/item-catalog/src/sync.integration.test.ts` — migration setup attempted and reached `ECONNREFUSED 127.0.0.1:5432`; no secondary teardown errors.

## Fix Round 3

- Restricted the realm locale to the canonical TR-safe path through encoded URL segments and added traversal/path-like locale regression coverage. `tr_TR` continues to produce the expected catalog URLs.
- Reworked database integration setup to create a uniquely generated, strictly validated `lol_test_*` disposable PostgreSQL database per suite, apply the checked-in migrations there, and drop only that exact verified database during teardown. Suites no longer delete public-schema rows or deactivate shared patches.
- Expanded rollback assertions to compare the complete prior champion/item snapshots and representative `BOOTS`/`CORE` categories after failed alias validation.

Round 3 verification:

- `bunx vitest run packages/item-catalog/src/client.test.ts packages/item-catalog/src/sync.integration.test.ts packages/database/src/schema.integration.test.ts` — 22 passed, 6 skipped without PostgreSQL.
- `bun run test` — 45 passed, 6 skipped.
- `bun run typecheck` — all workspaces passed.
- `bun run db:generate` — no schema changes.
- `git diff --check` — passed.
- Database attempt with `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats` reached `ECONNREFUSED 127.0.0.1:5432` while creating the disposable test database; no cleanup or assertion errors were masked.

The final locale regression run brought the full suite to 52 passing tests (6 conditional PostgreSQL skips).

## Fix Round 4

- Made catalog synchronization integration tests provision and tear down a unique migrated database per test, eliminating cross-test patch/row contamination. Rollback coverage now compares the exact prior active patch, complete champion/item snapshots, categories, and counts, and verifies the failed patch leaves no child rows.
- Refactored `createMigratedTestDatabase` with explicit admin/migration/test connection tracking, strict generated-name validation, ownership tracking before destructive cleanup, termination of remaining connections, and idempotent close behavior. Setup failures perform best-effort cleanup while rethrowing the original error with cleanup failures attached; admin teardown is always attempted in `finally`.
- Added injected-driver unit tests covering migration setup cleanup, primary-error preservation, idempotent close, and cleanup failures without requiring PostgreSQL.

Round 4 verification:

- `bunx vitest run packages/database/src/test-utils.test.ts` — 2 passed.
- `bunx vitest run packages/database/src/test-utils.test.ts packages/item-catalog/src/sync.integration.test.ts` — 2 passed, 2 conditional PostgreSQL skips.
- `bun run test` — 54 passed, 6 skipped.
- `bun run typecheck` — all workspaces passed.
- `bun run db:generate` — no schema changes, nothing to migrate.
- `git diff --check` — passed.
- `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/schema.integration.test.ts packages/item-catalog/src/sync.integration.test.ts` — attempted; PostgreSQL is unavailable (`ECONNREFUSED 127.0.0.1:5432`), with no secondary cleanup errors masking the connection failure.
