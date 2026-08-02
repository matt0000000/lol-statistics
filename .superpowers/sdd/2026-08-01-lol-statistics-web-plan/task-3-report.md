# Task 3 report: champion discovery and explicit role flow

Implemented the public champion discovery experience and role-selection flow for the Next.js app.

## Files

- `apps/web/app/{page,layout,globals.css,loading,not-found,error}.tsx`
- `apps/web/app/champions/[slug]/page.tsx`
- `apps/web/components/{ChampionGrid,ChampionGrid.test,RoleSelector,RoleSelector.test,ScopeBar}.tsx`
- `apps/web/tests/setup.ts`
- `apps/web/lib/route-factory.ts`
- `apps/web/package.json`, `vitest.config.ts`, root `package.json`, `bun.lock`

## Implementation

- Server pages use the HMR-safe `productionPublicQueries` singleton shared with API routes; no HTTP self-fetch or second pool is created.
- Home and champion pages are dynamic, resolve only public contracts, distinguish dataset warming, and use canonical case/diacritic-safe champion slug matching.
- Champion pages never choose a default role. Exact published roles are encoded in links; invalid/unavailable roles get an explicit message and valid alternatives.
- Added keyboard-friendly, localized/case/diacritic-insensitive bounded search with stable order, semantic cards, safe image dimensions/alt text/lazy loading, fixed TR1 Ranked Solo Emerald+ scope, and responsive dark-neutral styling.
- Added loading, not-found, and retryable client error boundaries plus metadata and reduced-motion/focus styles.

## Verification

- `bunx vitest run apps/web/components/RoleSelector.test.tsx apps/web/components/ChampionGrid.test.tsx` — 2 files, 6 tests passed.
- `bun run test` — 38 files passed, 8 skipped; 304 passed, 69 skipped.
- `bun run --cwd apps/web typecheck` — passed.
- `bun run --cwd apps/web build` — passed; dynamic `/` and `/champions/[slug]` routes compiled.
- `git diff --check` — pending before commit.

## Notes

The root Vitest config now loads `@vitejs/plugin-react` so the inline jsdom project can transform TSX tests. Database-backed integration tests remain environment-dependent as reported by Task 1.
