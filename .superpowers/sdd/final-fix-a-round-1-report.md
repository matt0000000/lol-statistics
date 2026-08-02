# Final fix A — catalog URL safety, round 1

Base: `c7cb9d2`

## Outcome

The canonical Data Dragon asset URL boundary now rejects any filename beginning
with an RFC-style scheme (`^[A-Za-z][A-Za-z0-9+.-]*:`), including mixed-case
`data:`, `http:`, `mailto:`, and custom schemes. Existing fixed-origin and
path/traversal checks remain unchanged.

Data Dragon supplies raw filenames rather than encoded path segments. To avoid
ambiguous double-encoding, percent-encoded escapes (`%` followed by two hex
digits, case-insensitive) are rejected. A safe literal percent is retained as
raw filename data and encoded once (`100%.png` → `100%25.png`).

## TDD evidence

- RED: `bunx vitest run packages/item-catalog/src/asset-url.test.ts` failed with
  6 expected failures for scheme-like and percent-encoded filenames before the
  production guard was added.
- GREEN: the focused suite passes with 29/29 tests after the guard.

## Verification

- `bun run test -- packages/item-catalog/src/asset-url.test.ts` — 29 passed.
- `bun run test` — 367 passed, 71 skipped (47 files passed, 8 skipped).
- `bun run typecheck` — all workspace packages passed.
- `bun run build` — `@lol/web` production build passed.
- `git diff --check` — passed.

The skipped tests are the repository's existing PostgreSQL-gated suites; no
test database was available in this environment.

## Files

- `packages/item-catalog/src/asset-url.ts`
- `packages/item-catalog/src/asset-url.test.ts`
- `.superpowers/sdd/final-fix-a-round-1-report.md`
