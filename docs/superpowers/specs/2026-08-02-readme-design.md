# Developer README Design Specification

**Status:** Approved in collaborative design review  
**Date:** 2026-08-02

## 1. Purpose and audience

Create a detailed root `README.md` for developers who want to install, run,
test, understand, or contribute to the TR League of Legends item-statistics
project. The README is an onboarding handbook, not a marketing landing page or
an exhaustive production runbook.

Production procedures remain authoritative in
[`docs/operations/collector.md`](../../operations/collector.md) and
[`docs/operations/web.md`](../../operations/web.md). The README summarizes and
links to those documents instead of duplicating every operational detail.

## 2. Information architecture

The README will contain these sections in order:

1. Project overview and exact MVP scope
2. Statistical interpretation and limitations
3. Architecture and collection-to-publication data flow
4. Technology stack and workspace layout
5. Prerequisites
6. Local quick start
7. Environment-variable reference
8. Database and collector workflow
9. Running the web application
10. Command reference
11. Test strategy and full integration setup
12. Public API overview
13. Security and privacy boundaries
14. Dataset freshness and patch rollover
15. Troubleshooting
16. Production operations references
17. Riot legal notice and project status

## 3. Local onboarding flow

The primary setup path uses repository commands exactly as implemented:

```bash
git clone https://github.com/matt0000000/lol-statistics.git
cd lol-statistics
bun install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres
bun run db:migrate
bun run collect
bun run dev
```

The surrounding explanation must make these constraints explicit:

- `RIOT_API_KEY` is a server-only collector secret.
- `DATABASE_READ_URL` is used by the web process. Local development may use
  the same database for writer and reader URLs.
- The collector derives statistics from Riot data; it does not download
  precomputed champion-item win rates.
- Statistics remain in a warming state until a current-patch publication
  completes.
- Development Riot keys expire and are unsuitable for scheduled production
  collection.

## 4. Product and statistical accuracy

The project scope must be prominent and unambiguous:

- TR1 only
- Ranked Solo/Duo queue 420
- Emerald through Challenger at collection time
- Current TR Data Dragon major/minor patch only
- Explicit role selection with no default role
- Completed core items, unordered two- and three-item multisets, and upgraded
  boots in a separate view

The README must characterize the output as descriptive correlation rather than
causal advice. It will briefly explain raw win rate, champion-role baseline,
baseline difference, build rate, sample size, 95% Wilson interval, the
confidence-adjusted ranking, and the 100-game recommendation threshold. It
will disclose survivorship and game-state bias and link to the full methodology
and design specification.

## 5. Architecture and repository map

Include a compact text flow:

```text
League-V4 + Match-V5 + Data Dragon
                 |
                 v
      resumable collector worker
                 |
                 v
        PostgreSQL canonical data
                 |
                 v
       immutable publications
                 |
                 v
     read-only API and Next.js UI
```

Describe `apps/web`, `apps/collector`, and each shared package by responsibility.
The repository map should help a new contributor identify the correct module
without cataloging every source file.

## 6. Configuration and commands

Document every root package script and all variables in `.env.example`.
Variable documentation must state process ownership and secrecy:

- `DATABASE_URL`: collector/migrations writer connection
- `DATABASE_READ_URL`: web read connection
- `RIOT_PLATFORM`: fixed to `TR1`
- `RIOT_REGION`: fixed to `EUROPE`
- `PUBLIC_SITE_URL`: web canonical origin
- `RIOT_API_KEY`: private Riot collector credential

Commands will be presented in task-oriented groups: development, collection,
database, tests, build, and health checks.

## 7. Testing design

Explain the test tiers without claiming unavailable checks pass:

- `bun run test` runs Vitest; PostgreSQL-gated suites skip when
  `TEST_DATABASE_URL` is absent.
- `bun run typecheck` validates all workspaces.
- `bun run build` builds the Next.js application.
- `bun run test:e2e` requires a writable `TEST_DATABASE_URL` whose database
  name ends in `_test`, and the same database is passed to the web process for
  reading.
- `bun run db:generate` and `bunx drizzle-kit check` detect migration/schema
  drift.

The README will include a safe full-test database example and warn that E2E
seeding truncates and replaces fixture data in that explicitly named test
database.

## 8. Security, privacy, and publication semantics

Document that Riot keys, database credentials, PUUIDs, match records, raw final
slots, ladder snapshots, and private collector errors are server-only. The web
process reads security-barrier public views through a restricted reader role.

Explain that publication is atomic, partial collector runs remain private, a
failed same-patch refresh leaves the previous publication active, and a patch
rollover intentionally shows warming rather than labeling old-patch data as
current. Fresh means at most six hours old; older publications are stale.

## 9. Troubleshooting

Provide concise symptom/cause/action entries for:

- missing or expired Riot API key
- PostgreSQL connection failures
- `dataset_warming`
- stale publications
- skipped PostgreSQL tests
- rejected unsafe E2E database names
- port conflicts
- Data Dragon/current-patch synchronization delays

## 10. Legal and maintenance notes

Include the exact Riot disclaimer rendered by the application. State that the
project is an MVP scoped to TR1/current-patch Ranked Solo statistics. Link to
the design specification and both operations guides for deeper details.

## 11. Acceptance criteria

The completed README must:

- be accurate against current scripts, environment validation, and source
  behavior;
- provide a copy-paste local path from clone to web UI;
- distinguish fast offline tests from PostgreSQL/E2E gates;
- contain no real credential, PUUID, or private database value;
- avoid promising precomputed Riot statistics or causal recommendations;
- link to repository-relative docs with valid paths;
- contain no placeholders, stale command names, or duplicated production
  runbook sections.
