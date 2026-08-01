# Task 3 report: canonical PostgreSQL schema and migrations

## Implementation

Added `@lol/database` with a concrete Drizzle PostgreSQL schema for patches, catalogs, collection runs, ladder snapshots, matches, participant observations and normalized item rows, immutable aggregate publications, and item/combination/boots aggregates. The schema includes the required composite primary keys, unique constraints, indexes, partial unique active-publication index, foreign keys, PostgreSQL enums, and data checks. Added the database factory, migration entry point, Drizzle config, and generated `migrations/0000_initial.sql` with its metadata snapshot.

## RED/GREEN evidence

- RED: `TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bunx vitest run packages/database/src/schema.integration.test.ts` initially failed because `./client` did not exist.
- GREEN (static): `bun run typecheck` passed for all workspaces; `bun run db:generate` reported no schema changes after the checked-in migration; `bunx drizzle-kit check` reported “Everything's fine”.
- GREEN (test without a database): `bun run test` passed (3 files/3 tests) and skipped the integration suite because `TEST_DATABASE_URL` was absent.

## Database runtime limitation

`DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats bun run db:migrate` cannot run in this environment: PostgreSQL is unavailable and the connection fails with `ECONNREFUSED 127.0.0.1:5432`. The same error occurs when running the integration test with `TEST_DATABASE_URL` set. No PostgreSQL architecture or embedded database substitute was added.

## Files changed

- `packages/database/package.json`, `packages/database/tsconfig.json`
- `packages/database/src/client.ts`, `packages/database/src/schema.ts`, `packages/database/src/migrate.ts`, `packages/database/src/index.ts`, `packages/database/src/schema.integration.test.ts`, `packages/database/src/schema.contract.test.ts`
- `drizzle.config.ts`
- `migrations/0000_initial.sql`, `migrations/meta/0000_snapshot.json`, `migrations/meta/_journal.json`
- `bun.lock`

## Self-review

The migration is deterministic and checked in, table keys match the task contract, private PUUID/raw-slot fields remain confined to collection tables, and aggregate publication activation is constrained to one active row. Static typechecking, migration generation/checking, test execution, and whitespace checks passed. Live migration and integration assertions remain unverified solely because no PostgreSQL server is available.

## Fix Round 1

- Imported `ROLES` and `PatchKey` from `@lol/domain`; the role enum uses the shared runtime tuple, patch keys are typed and constrained to `major.minor` format, and `patches_one_active_idx` permits at most one active patch.
- Added `patch_id` to participant core-item/boots rows with composite foreign keys to the exact participant observation and patch-scoped item catalog row. Added the observation identity/patch unique key needed by those references.
- Added nonnegative wins/losses/sample checks to combination aggregates.
- Regenerated `migrations/0000_initial.sql` and metadata; added focused source/migration contract assertions in `schema.contract.test.ts`.

Fix verification:

- `bunx vitest run packages/database/src/schema.contract.test.ts` — 4 passed.
- `bun run typecheck` — all four workspaces passed.
- `bun run db:generate` — no schema changes, nothing to migrate.
- `bunx drizzle-kit check` — Everything's fine.
- `git diff --check` — clean.
