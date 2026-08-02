# Task 6 fix round 2 report

## Fixes

- `apps/web/lib/security-boundary.ts` now reads the scan root's applicable
  `tsconfig.json` `baseUrl`/`paths`, resolves exact and wildcard aliases, and
  follows static imports, dynamic `import()`, `require()`, re-exports,
  extension variants, index files, and `@lol/*` workspace modules. Configured
  aliases that cannot be resolved are reported; arbitrary external packages
  are not traversed. Alias regressions live in isolated test fixtures so the
  scanner source cannot trigger its own private-term rules.
- E2E seeding now requires `TEST_DATABASE_URL` exclusively and validates a
  PostgreSQL database name ending in `_test` before opening a connection.
  Playwright runs the same validation before starting Next and passes that
  exact URL to the web server as `DATABASE_READ_URL`; read/production URL
  fallbacks were removed from the seed helper and fixture.
- Next's generated `apps/web/next-env.d.ts` is ignored, with TypeScript still
  including `.next/types/**/*.ts`. The regression checks the ignore/config
  contract. The pre-existing generated rewrite was restored to the intended
  `.next/types` content before verification; when committing, remove the
  tracked entry (`git rm --cached apps/web/next-env.d.ts`) so future dev/build
  runs cannot dirty the worktree.
- Updated web operations and phase acceptance commands to use
  `TEST_DATABASE_URL` for E2E.

## Verification

- Focused security/seed/Playwright/next-env Vitest: **12 passed**.
- `bun run test`: **321 passed, 71 skipped; 8 integration files skipped**.
- `bun run typecheck`: **PASS** for all workspace packages.
- `bun run db:generate`: **PASS**, no schema changes.
- `bun run build`: **PASS** (`@lol/web`).
- `git diff --check`: **PASS**.
- `TEST_DATABASE_URL=postgres://lol:lol@127.0.0.1:5432/lol_stats_test bun run test:e2e`:
  attempted without skips; seed flows fail explicitly with
  `ECONNREFUSED 127.0.0.1:5432`, and browser launch reports missing
  `libnspr4.so`. This environment has neither PostgreSQL nor a runnable
  Chromium host.

## Handoff

The generated `next-env.d.ts` was restored after the E2E attempt. Before the
round-2 commit, stage its removal from the index (`git rm --cached
apps/web/next-env.d.ts`); the ignored generated file may remain on disk.
