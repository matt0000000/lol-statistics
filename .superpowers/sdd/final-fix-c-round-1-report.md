# Final Fix C — participant identity and synthetic-ID tolerance (round 1)

## Base

`f6c57e6d415d74cc9d564c8048f8dcbd386a19bc`

## Implemented

- Match validation now always checks metadata uniqueness, raw usable PUUID
  uniqueness and metadata membership, and participant-ID uniqueness for every
  fully valid row. Exact metadata/info identity-set equality is applied when
  all rows expose usable PUUIDs; rows without PUUIDs retain known-subset
  tolerance without inventing cardinality.
- Ingestion precomputes all participant-schema-valid IDs before processing and
  allocates deterministic synthetic rejection IDs outside that reserved set and
  previously allocated synthetic IDs. Malformed-first, reordered, repeated,
  and multiple-malformed inputs are covered by regressions.

## Verification

- `bunx vitest run packages/riot-client/src/match.test.ts apps/collector/src/services/ingest-match.test.ts` — 30 passed.
- `bun run test` — 384 passed, 75 skipped (9 PG/e2e-gated files skipped).
- `bun run typecheck` — all workspace packages passed.
- `bun run db:generate` twice — no schema changes generated.
- `bunx drizzle-kit check` — passed.
- `bun run build` — Next.js production build passed.
- `TEST_DATABASE_URL` is unset; PostgreSQL integration tests remain explicitly skipped.
