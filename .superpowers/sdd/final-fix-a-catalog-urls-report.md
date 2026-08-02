# Final fix A — canonical catalog asset URLs

Base: `059ef52`

## Outcome

Data Dragon `image.full` filenames are converted before catalog persistence to
canonical HTTPS URLs of the form:

`https://ddragon.leagueoflegends.com/cdn/{exact-version}/img/{champion|item}/{encoded-filename}`

The shared URL constructor rejects empty or malformed versions, unknown resource
paths, path separators, control characters, query/fragment delimiters, and all
absolute/arbitrary image origins. Public URL contracts remain strict; no schema
was widened. Existing Next image configuration already allows only the official
`https://ddragon.leagueoflegends.com/cdn/**` host/path and was not broadened.

## TDD evidence

- RED: `bunx vitest run packages/item-catalog/src/asset-url.test.ts` failed because
  the URL helper did not exist.
- GREEN: URL helper and catalog-boundary tests pass (`55` focused item-catalog
  tests; fixture URL coverage includes champion/item paths, patch components,
  encoded filenames, and unsafe input rejection).

## Verification

- `bunx vitest run packages/item-catalog` — **70 passed, 2 skipped** (PostgreSQL
  integration tests gated by missing `TEST_DATABASE_URL`).
- `bun run test` (repository Vitest command) — **359 passed, 71 skipped** across
  55 files.
- `bunx vitest run packages/public-api apps/web/lib apps/web/tests/api-routes.test.ts apps/web/app/champions/'[slug]'/page.test.ts` — **79 passed, 11 skipped**.
- `bun --filter '*' typecheck` — passed for all workspace packages.
- `bun run build` — Next production build passed.
- `bun run db:generate` — no schema changes.
- `bunx drizzle-kit check` — passed.
- Native `bun test` (non-authoritative convenience command) — baseline environment failures remain: Playwright specs and React
  component tests run under Bun without the configured browser/jsdom environment
  (27 failures, 3 errors); unrelated tests passed. PostgreSQL suites remained
  skipped because no test database was available.

## Residual risks

The canonicalization boundary intentionally accepts Data Dragon catalog
filenames only. Custom absolute image URLs are rejected, including otherwise
valid non-CDN fixture origins, because the design requires the official CDN and
the web image allowlist is intentionally narrow.
