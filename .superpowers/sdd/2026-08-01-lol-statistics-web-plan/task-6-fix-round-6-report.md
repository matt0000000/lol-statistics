# Task 6 fix round 6 report

## Fixes

- Updated configured `paths` prevalidation to mirror TypeScript `findBestPatternMatch`: exact keys win, wildcard candidates are selected by strictly longest literal prefix, and equal-prefix ties retain `tsconfig` declaration order.
- Preserved suffix compatibility, empty wildcard substitutions, and validation of every target in the selected mapping.
- Added an integration regression where `@foo/*` precedes `@foo/*bar`; the first mapping has an unsafe outside target followed by a benign fallback, while the second mapping is benign. The scanner now fails closed on the compiler-selected first mapping instead of allowing the suffix-longer mapping to bypass prevalidation.

## Verification

- `bunx vitest run apps/web/tests/security-boundary.test.ts -t 'equal-prefix wildcard aliases'`: **RED before fix** (1 failed), then **GREEN after fix**.
- `bunx vitest run apps/web/tests/security-boundary.test.ts`: **15 passed**.
- `bun run test`: **331 passed, 71 skipped; 8 files skipped**.
- `bun run typecheck`: **PASS** for all packages.
- `bun run db:generate`: **PASS; no schema changes**.
- `bun run build`: **PASS**.
- `git diff --check`: **PASS**.

## Residual risk

- The scanner continues to treat configured path mappings as workspace-boundary policy; aliases targeting external source trees fail closed even where TypeScript could legally consume them.
- E2E was not rerun because this correction only changes static alias matching and its scanner fixture.
