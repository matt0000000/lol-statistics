# Broad web review fix round 1

## Changes

- Added `baselineDelta` to the public sort schema, stable JavaScript comparator, all item/pair/trio/boots SQL ordering branches, API parsing/cache keys, canonical page controls, sortable table headers, and deterministic E2E sort expectations. SQL and JavaScript use the same raw-minus-baseline double-precision expression and sample/key tie-breaks.
- Replaced the hardcoded `.local` metadata origin with validated `PUBLIC_SITE_URL` consumption. Unsafe protocols, credentials, missing production runtime configuration, and non-HTTPS production origins fail closed without echoing secrets; build-time omission remains compatible with Next production builds.
- Results tables now expose the exact last publication timestamp as an accessible UTC `<time>` alongside the relative age, including empty-result states. The existing patch, scope, coverage, baseline, sample, and correlation disclosures remain intact.
- Changed the document language to `en`, aligned design/plan endpoint sort documentation, and removed only the committed blank EOF lines from the two requested reports.

## Verification

- `bun run test` — 335 passed, 71 skipped (PostgreSQL-gated tests skipped because `TEST_DATABASE_URL` is unset).
- `bun run typecheck` — all workspace packages passed.
- `bunx drizzle-kit check` — passed.
- `bun run db:generate` — no schema changes.
- `DATABASE_READ_URL=postgres://lol:lol@localhost:5432/lol_stats PUBLIC_SITE_URL=https://stats.example bun run build` — production build passed.
- `git diff --check` — passed.
- Browser E2E and PostgreSQL runtime integration were not run because the environment does not provide the required browser host libraries or PostgreSQL server; their gates remain intact.

## Residual risks

- Runtime metadata validation and PostgreSQL SQL ordering/collation still require deployment/runtime coverage. The focused pure and fake-executor tests cover negative/positive deltas, exact SQL text/bindings, URL canonicalization, and all sort branches without a circular production oracle.
