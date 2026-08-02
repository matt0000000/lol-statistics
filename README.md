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

