# TR League of Legends Item Statistics

A data-driven statistics application for exploring how completed items and
unordered item combinations correlate with wins for League of Legends
champions on the Turkish server.

> [!IMPORTANT]
> This project does not provide causal build advice. Its output is descriptive
> aggregate evidence with sample sizes and uncertainty.

## Project scope

The MVP has a deliberately narrow and reproducible scope:

| Dimension | Included |
| --- | --- |
| Platform | `TR1` only |
| Queue | Ranked Solo/Duo, queue `420` |
| Rank | Emerald, Diamond, Master, Grandmaster, and Challenger at collection time |
| Patch | Current TR Data Dragon major/minor patch only |
| Roles | TOP, JUNGLE, MIDDLE, BOTTOM, or Support (`UTILITY`), selected explicitly |
| Statistics | Completed core items, unordered two-item pairs, unordered three-item trios, and upgraded boots |

There is no default role and no cross-role fallback. The project does not
include other regions, Flex Queue, ARAM, Arena, normal games, historical patch
comparison, item purchase order, player profiles, or personalized advice.

## Table of contents

- [What the statistics mean](#what-the-statistics-mean)
- [Architecture](#architecture)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Database and collector workflow](#database-and-collector-workflow)
- [Running the web application](#running-the-web-application)
- [Commands](#commands)
- [Testing](#testing)
- [Public API](#public-api)
- [Security and privacy](#security-and-privacy)
- [Dataset freshness](#dataset-freshness)
- [Troubleshooting](#troubleshooting)
- [Operations](#operations)
- [Legal notice](#legal-notice)

## What the statistics mean

Riot does not publish precomputed champion-item win rates. This project derives
them from the eligible TR ladder population and Match-V5 data, then publishes
only champion-role aggregates.

| Statistic | Meaning |
| --- | --- |
| Raw win rate | `wins with the item or combination / sample` |
| Build rate | `sample / eligible champion-role games` |
| Champion-role baseline | Win rate across every eligible observation for that champion and role |
| Baseline difference | `raw win rate - champion-role baseline win rate` |
| Confidence interval | 95% Wilson score interval for the observed win rate |
| Confidence-adjusted score | Lower bound of the 95% Wilson interval |
| Recommendation threshold | At least 100 games |

The default ranking uses the confidence-adjusted score rather than raw win
rate. Rows below the 100-game threshold remain accessible when low-confidence
results are explicitly enabled, but they are never presented as recommended.

Pairs and trios are unordered contained multisets. If an eligible final
inventory contains more than two or three core items, it contributes to every
contained pair or trio at most once. Legitimate duplicate-item cases remain
distinguishable. Because combinations overlap, their build-rate percentages do
not sum to 100%. Upgraded boots are normalized and shown separately from core
items.

These statistics have important limitations:

- **Correlation is not causation.** An item can be associated with winning
  without causing the win.
- **Survivorship bias matters.** Final inventories describe players who
  reached those completed items.
- **Game state matters.** Players who are already ahead can buy more expensive
  items and finish larger builds, creating gold-lead bias.
- **Rank is rank at collection time.** The ladder snapshot is not a historical
  reconstruction of rank at the moment each match was played.
- **The data is patch-specific.** Old-patch observations are never labeled as
  current-patch evidence.

See the [full design and methodology specification](docs/superpowers/specs/2026-08-01-lol-item-statistics-design.md)
for eligibility rules, item classification, formulas, publication invariants,
and acknowledged limitations.

## Architecture

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

The private collector executes a durable stage machine:

```text
CATALOG -> LADDER -> DISCOVERY -> MATCHES -> AGGREGATES -> VERIFY -> PUBLISH
```

1. **CATALOG** resolves the current TR realm version and synchronizes Data
   Dragon champion and item metadata.
2. **LADDER** snapshots Emerald through Challenger Ranked Solo players from
   League-V4.
3. **DISCOVERY** requests up to 35 days of queue-420 match IDs for the sampled
   PUUIDs and deduplicates the match graph.
4. **MATCHES** fetches Match-V5 payloads through the EUROPE route, validates
   participants independently, and persists eligible observations atomically.
5. **AGGREGATES** rebuilds champion-role baselines, item statistics, unordered
   combinations, and boots statistics from the exact coverage window.
6. **VERIFY** recomputes and checks publication invariants.
7. **PUBLISH** atomically advances the current-patch publication pointer.

Every scheduled invocation creates a fresh run and 35-day coverage window.
Failed nonterminal runs can resume from durable checkpoints while their Riot
discovery window is still admissible. A failed same-patch refresh leaves the
last successful publication active. A patch rollover intentionally enters a
warming state until new-patch data passes verification; old-patch statistics
are never relabeled as current.

The web process is a separate, read-only consumer. Its APIs resolve one
immutable active publication, validate responses with strict public contracts,
and use publication-scoped ETags. Private collection identifiers and canonical
tables are outside the web boundary.

## Technology stack

- [Bun](https://bun.sh/) workspaces and TypeScript 5.9
- [Next.js](https://nextjs.org/) App Router and React
- PostgreSQL 17 with [Drizzle ORM](https://orm.drizzle.team/)
- Vitest for unit and database-gated integration tests
- Playwright for browser flows
- Docker Compose for local PostgreSQL
- Riot League-V4, Match-V5, and Data Dragon

## Repository structure

```text
apps/
  collector/       resumable private data pipeline and CLI
  web/             Next.js UI and read-only HTTP API
packages/
  database/        schema, migrations, repositories, transactions
  domain/          roles, eligibility, combinations, statistics
  item-catalog/    Data Dragon sync and item normalization
  public-api/      public contracts, views, queries, stable sorting
  riot-client/     Riot HTTP boundary, routing, retries, rate limits
docs/
  operations/      collector and web runbooks
  superpowers/     approved design and implementation plans
migrations/        checked-in PostgreSQL migrations and snapshots
e2e/               Playwright browser flows
fixtures/riot/     deterministic Riot and Data Dragon test fixtures
```

## Prerequisites

Install or obtain:

- **Git** for cloning and normal contribution workflows.
- **Bun** compatible with the checked-in `bun.lock`.
- **Docker with Compose support**, or an equivalent PostgreSQL 17 instance.
- **A Riot developer API key** for real collector runs. Development keys expire
  and are intended for local prototyping, not scheduled public deployment.
- **Playwright browser dependencies** only if you intend to run the E2E suite.

No Riot key is needed to build the web application or run the default offline
test suite.

## Quick start

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

Before running the collector, open `.env` and set `RIOT_API_KEY` to your private
development credential. Do not commit that file or paste the key into logs,
issues, browser code, or screenshots.

The default local site is <http://localhost:3000>. The first collector run can
take significant time because it snapshots the eligible ladder, discovers and
fetches matches, rebuilds aggregates, verifies them, and publishes atomically.
Until a current-patch publication succeeds, the site correctly reports that
the dataset is warming.

## Configuration

Start from `.env.example`:

| Variable | Used by | Required | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | migrations and collector | Yes for database writes | PostgreSQL writer connection |
| `DATABASE_READ_URL` | web | Yes when serving data | Restricted read-only PostgreSQL connection |
| `RIOT_PLATFORM` | collector | Fixed | Must be `TR1` |
| `RIOT_REGION` | collector | Fixed | Must be `EUROPE` for TR1 Match-V5 routing |
| `PUBLIC_SITE_URL` | web | Deployment-dependent | Canonical HTTP(S) origin; HTTPS is required in production |
| `RIOT_API_KEY` | collector | Yes for real collection | Private Riot API credential |
| `TEST_DATABASE_URL` | integration and E2E tests | Only for full database/browser tests | Writable PostgreSQL database whose name ends in `_test` |

For local development, `DATABASE_URL` and `DATABASE_READ_URL` may point to the
same `lol_stats` database. Production should use separate writer and reader
credentials; the web reader receives access only to the public security-barrier
views described in the [web operations guide](docs/operations/web.md).

The web application never reads `RIOT_API_KEY`. The collector never exposes
that key to the browser.

## Database and collector workflow

Start PostgreSQL and apply the checked-in migrations:

```bash
docker compose up -d postgres
bun run db:migrate
```

Run one collection cycle:

```bash
bun run collect
```

Migrations are explicit; a normal collector invocation does not apply them.
The collector is a separate process from the web application and should be
scheduled externally—hourly by default in production. PostgreSQL advisory
locking prevents overlapping workers, while durable stage and match
checkpoints allow eligible failed runs to resume.

Inspect public-safe collector health without printing credentials, PUUIDs, or
private error details:

```bash
bun run collector:health -- --json
```

Collector exit codes are designed for schedulers:

| Exit code | Meaning |
| --- | --- |
| `0` | success |
| `1` | configuration, database, or unclassified failure |
| `2` | authentication or expired Riot key |
| `3` | publication invariant failure |
| `4` | exhausted transient or rate-limit failure |

See [Collector operations](docs/operations/collector.md) for restart,
checkpoint, rollover, logging, and production-key details.

## Running the web application

Start the development server after configuring `DATABASE_READ_URL`:

```bash
bun run dev
```

The web process reads only the active immutable publication. It does not run
collection, write canonical data, or provide a hidden fixture fallback. A
production build can be checked with:

```bash
bun run build
```

In production, `PUBLIC_SITE_URL` must be an HTTPS origin and the database URL
must belong to a reader role restricted to the published public views.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Next.js development server |
| `bun run build` | Create the production web build |
| `bun run test` | Run Vitest once; database-gated suites skip without `TEST_DATABASE_URL` |
| `bun run test:watch` | Run Vitest in watch mode |
| `bun run typecheck` | Type-check every workspace |
| `bun run db:generate` | Compare the Drizzle schema with checked-in migrations |
| `bun run db:migrate` | Apply checked-in PostgreSQL migrations |
| `bun run collect` | Execute one resumable collection run |
| `bun run collector:health -- --json` | Print public-safe collector health JSON |
| `bun run seed:e2e` | Seed the explicitly configured test database |
| `bun run test:e2e` | Run Playwright against the validated test database |

Use `bun run test`, not native `bun test`, as the authoritative test command.
The project test configuration and browser environment are wired through
Vitest.

## Testing

### Fast local verification

These checks do not require a Riot key:

```bash
bun run test
bun run typecheck
bun run build
bun run db:generate
bunx drizzle-kit check
git diff --check
```

Without `TEST_DATABASE_URL`, Vitest reports the PostgreSQL-gated files as
skipped. That is expected and must not be described as full database runtime
coverage.

### PostgreSQL integration and browser tests

Create a disposable test database whose name ends in `_test`:

```bash
docker compose up -d postgres
docker compose exec -T postgres createdb -U lol lol_stats_test
DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats_test bun run db:migrate
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats_test bun run test
TEST_DATABASE_URL=postgres://lol:lol@localhost:5432/lol_stats_test bun run test:e2e
```

The E2E workflow refuses to start unless `TEST_DATABASE_URL` is explicitly
provided and its parsed database name ends in `_test`. It does not fall back to
`DATABASE_URL` or `DATABASE_READ_URL`. Seeding truncates and replaces fixture
data in that test database, so never point it at development, staging, or
production data. Playwright also requires its normal browser and host-system
libraries.

## Public API

The Next.js application exposes publication-scoped, read-only endpoints:

```text
GET /api/meta
GET /api/champions
GET /api/champions/{championId}
GET /api/champions/{championId}/roles/{role}/stats
GET /api/methodology
```

Example:

```text
/api/champions/222/roles/BOTTOM/stats?view=pairs&sort=adjusted&includeLowConfidence=false
```

Statistics requests require an explicit role. Supported controls are:

- `view=items|pairs|trios|boots`
- `sort=adjusted|winRate|baselineDelta|buildRate|sample`
- `includeLowConfidence=true|false`

Responses use strict public contracts, bounded inputs, and ETags tied to the
immutable publication ID. When no valid current-patch publication exists,
statistics endpoints return a machine-readable `dataset_warming` response
instead of old-patch data.

## Security and privacy

The collector and web processes have intentionally different trust boundaries.

Server-only data includes:

- Riot API keys and database credentials
- PUUIDs and ladder snapshots
- canonical match records and raw final slots
- participant observations and rejection audits
- private collector checkpoints and error details

The web process reads only security-barrier views containing current-patch
catalog metadata, immutable aggregate publications, and public-safe collector
status. Its production database role should have `USAGE` on the public schema
and `SELECT` only on those views. API responses and client components are
statically tested against imports or fields that would cross this boundary.

Never add a Riot key to a `NEXT_PUBLIC_*` variable, browser fixture, client
component, API response, committed environment file, or application log.

## Dataset freshness

The UI and API distinguish three states:

- **Warming:** no valid publication exists for the current TR patch.
- **Fresh:** the active publication is no more than six hours old.
- **Stale:** the active publication is older than six hours and remains visible
  with a warning.

A failed same-patch refresh leaves the previous successful publication active.
At patch rollover, old-patch data is deliberately removed from the current
pointer and the new patch warms until it passes aggregate verification and
publication. This prevents stale patch data from being mislabeled as current.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Collector exits with code `2` | Missing or expired Riot development key | Refresh the key in the Riot developer portal and update the private `.env` value |
| `ECONNREFUSED` on port 5432 | PostgreSQL is stopped or the URL is wrong | Run `docker compose up -d postgres` and check `DATABASE_URL`/`DATABASE_READ_URL` |
| Site reports `dataset_warming` | No verified publication exists for the active patch | Run the collector and inspect `bun run collector:health -- --json` |
| Site shows a stale warning | Last successful same-patch publication is over six hours old | Inspect collector health, Riot authentication, rate limits, and scheduler execution |
| Database tests are skipped | `TEST_DATABASE_URL` is absent | Create a disposable `_test` database and rerun Vitest with the variable set |
| E2E refuses to start | Missing or unsafe test database URL | Set `TEST_DATABASE_URL` to a writable PostgreSQL database ending in `_test` |
| Port 3000 is already in use | Another development server is running | Stop it or start Next.js on an alternate port with `bun --filter @lol/web dev -- --port 3001` |
| New live matches do not publish immediately after a patch | Data Dragon and the live game version are temporarily out of sync | Wait for matching TR Data Dragon metadata; unmatched versions remain unpublished by design |

## Operations

The README is the local developer entrypoint. Use the dedicated runbooks for
production details:

- [Collector operations](docs/operations/collector.md): scheduling, restart
  semantics, exit codes, keys, rate limits, checkpoints, and health output.
- [Web operations](docs/operations/web.md): read-only database grants, HTTPS,
  caching, health checks, deployment ordering, and E2E database safety.
- [Design specification](docs/superpowers/specs/2026-08-01-lol-item-statistics-design.md):
  product scope, methodology, data model, invariants, and security design.

## Legal notice

This product is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

This repository is an MVP focused on current-patch TR1 Ranked Solo item
statistics. Any expansion to other queues, regions, modes, or historical data
requires a separate methodology and policy review.
