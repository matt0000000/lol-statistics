# Task 6 fix round 3 report

## Fixes

- Replaced the hand-rolled `tsconfig.json` parser with TypeScript 5.9's
  `readConfigFile` and `parseJsonConfigFileContent`, preserving JSONC comments,
  trailing commas, inherited `baseUrl`/`paths`, and diagnostics. Invalid config
  and `extends` cycles now fail explicitly.
- Implemented TypeScript-compatible path selection: exact aliases always win;
  wildcard aliases are ranked by literal prefix and suffix specificity; target
  arrays remain in declaration order.
- Replaced import regex scanning with TypeScript AST traversal for static,
  dynamic, `require`, import-equals, and re-export edges.
- Canonicalized resolved files through `realpath`, allowed only workspace files,
  and rejected `node_modules` or symlink escapes. Unsafe aliases are reported as
  unresolved, including when an unsafe first target would otherwise fall through
  to a benign target.
- Added isolated regressions for exact-overlap aliases, inherited JSONC config,
  config cycles, unsafe targets, and comment/string import lookalikes.

## Verification

- `bunx vitest run apps/web/tests/security-boundary.test.ts`: **10 passed**.
- `bun run test`: **326 passed, 71 skipped; 8 files skipped**.
- `bun run typecheck`: **PASS** for all workspace packages.
- `bun run db:generate`: **PASS**, no schema changes.
- `bun run build`: **PASS** (`@lol/web`).
- `git diff --check`: **PASS**.
- E2E was not rerun because this round changes no E2E code; prior round's
  environment blockers (database/browser host) remain documented.

## Residual risk

The scanner still treats private-term matches in reachable source text as
violations, including comments or ordinary string literals; only import-edge
extraction was moved to AST traversal. This preserves the existing policy for
literal fixture/content checks while eliminating import-regex false positives.
