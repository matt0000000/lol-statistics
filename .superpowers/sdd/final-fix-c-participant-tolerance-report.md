# Final Fix C — Participant tolerance

## Outcome

- Match-level Riot validation remains strict for routing/queue, match ID,
  version, timestamps, duration, and participant-array shape.
- `participantSchema` is exported as the required participant parser. The
  match parser carries raw participant elements through so ingestion can
  validate each independently.
- Ingestion records malformed/non-object participant elements as bounded
  `required_field` rejections, using a deterministic collision-free
  participant-array index for private audit uniqueness. No placeholder PUUID,
  raw payload, or private identifier is logged or exposed publicly.
- Valid participants continue through eligibility and inventory normalization;
  valid early-surrender flags retain match-remake behavior, while malformed
  early-surrender fields reject only that participant.

## Verification

- `bunx vitest run packages/riot-client/src/match.test.ts apps/collector/src/services/ingest-match.test.ts` — 24 passed.
- `bun run test` — 378 passed, 75 skipped (9 PG/e2e-gated files skipped).
- `bun run typecheck` — all workspace packages passed.
- `bun run db:generate` twice — no schema changes generated.
- `bunx drizzle-kit check` — passed.
- `bun run build` — Next.js production build passed.

PostgreSQL integration tests are present and remain explicitly skipped because
`TEST_DATABASE_URL` is unavailable in this environment.
