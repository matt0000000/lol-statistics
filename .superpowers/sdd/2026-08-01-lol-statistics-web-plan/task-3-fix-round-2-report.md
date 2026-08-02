# Web Task 3 fix round 2: hostile unavailable roles

## Implementation summary

- Added a shared `isRole` guard backed by the public role enum and reused it for champion-page query parsing, canonical redirects, and `RoleSelector` warning labels.
- Sanitized inherited-property names (`__proto__`, `constructor`, and `toString`) to a bounded generic unavailable-role message, preventing React object/function child errors and preserving valid role links.
- Made the role-label table frozen and null-prototype, and added resolver/component regressions covering all three hostile values and no-role-default behavior.

## Files

- `packages/public-api/src/contracts.ts`
- `apps/web/app/champions/[slug]/page.tsx`
- `apps/web/app/champions/[slug]/page.test.ts`
- `apps/web/components/RoleSelector.tsx`
- `apps/web/components/RoleSelector.test.tsx`

## Verification

- `bun run test` — 36 files passed, 8 skipped; 278 tests passed, 69 skipped.
- `bunx vitest run apps/web/components/RoleSelector.test.tsx 'apps/web/app/champions/[slug]/page.test.ts'` — 2 files, 15 tests passed.
- `bun run typecheck` — all workspace packages passed.
- `bun --filter @lol/web build` — Next.js production build passed; all routes compiled.
- `git diff --check` — passed.

## Notes

The changeset commit SHA and diff counts were supplied to the coordinator after commit. No `progress.md` file was modified.
