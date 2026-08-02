# Task 4 fix round 1 report

Implemented the review fixes for responsive evidence cards, canonical controls,
strict public statistics contracts, and rounded signed formatting.

## Changes

- Evidence rows switch to a labeled card layout through `959px`, with bounded
  table/cell/item wrappers and `minmax(0, 1fr)` grids so 720px and 320px shells
  cannot create horizontal overflow. The table caption remains semantic.
- Champion-page canonicalization now compares URLSearchParams-derived canonical
  state even for an already canonical slug. Defaults, arrays, duplicates,
  unknown controls, control characters, and oversized values are removed;
  bounded safe unavailable-role strings (including `ADC`) are retained once,
  without redirect loops.
- Public rows/responses enforce positive samples, exact wins/losses, canonical
  nondecreasing keys, Wilson interval bounds, adjusted-score parity, view
  cardinality, confidence/minimum-sample parity, baseline/build/delta formulas,
  and a documented `1e-9` relative/absolute derived-value tolerance. Malformed
  database rows fail closed instead of being coerced.
- Percent/delta formatters round before sign selection, rendering negative-zero
  boundaries as `0.0%` and `+0.0 pp`; non-finite values remain an em dash.

## Verification

- `bun run test` — 293 passed, 69 skipped (362 total)
- `bun run typecheck` — all workspace packages passed
- `git diff --check` — passed
