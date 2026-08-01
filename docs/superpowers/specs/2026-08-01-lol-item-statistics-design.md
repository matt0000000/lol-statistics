# TR League of Legends Item Statistics — Design Specification

**Status:** Approved in collaborative design review  
**Date:** 2026-08-01

## 1. Product Summary

Build a data-driven League of Legends statistics website that helps a player understand which completed items and unordered item combinations correlate with wins for a champion in a selected role.

The MVP covers only:

- Platform: TR1
- Queue: Ranked Solo/Duo (`queueId = 420`)
- Rank at collection time: Emerald through Challenger
- Patch: the current TR realm Data Dragon major/minor patch
- Roles: top, jungle, middle, bottom, and utility; the user must choose one explicitly
- Results: individual completed core items, unordered two-item combinations, unordered three-item combinations, and upgraded boots in a separate view

The website presents descriptive evidence, not commands. It shows several credible choices with transparent sample sizes and uncertainty instead of claiming that the highest observed win rate is always the best decision.

## 2. Goals and Success Criteria

### Goals

- Collect a reproducible current-patch TR1 Emerald+ Ranked Solo dataset from Riot's public APIs.
- Keep Riot API traffic and credentials entirely in a private backend collector.
- Publish fast champion-and-role aggregate statistics with raw win rate, build rate, sample size, confidence interval, and a confidence-adjusted ranking.
- Prevent cross-patch, cross-role, cross-queue, and below-Emerald observations from entering published aggregates.
- Make statistical limitations and dataset freshness visible to users.

### MVP success criteria

- Every champion-role pair found in the eligible dataset can be queried.
- No role is preselected on a champion page.
- Every visible statistic identifies TR1, Ranked Solo, Emerald+, the patch, sample size, and last successful publication time.
- Reprocessing the same ladder pages and matches does not duplicate observations or change correct aggregates.
- A failed refresh cannot replace the last successful published dataset with partial data.
- The Riot key and PUUIDs never appear in browser responses, client bundles, or application logs.
- Core statistics API responses are cacheable and target a warm response time below 500 ms.

## 3. Non-Goals

- Other regions, queues, ranks, or historical patch comparison
- Arena, ARAM, normal games, Flex Queue, or professional-play data
- Exact purchase order or timeline analysis
- Components, starter items, consumables, trinkets, or active in-game advice
- Match-history or summoner-profile pages
- Claims that an item caused a win
- Personalized recommendations or Riot Sign On
- Monetization in the MVP

## 4. Public Data Feasibility

Riot does not provide precomputed champion-item win rates. The product derives them from public data:

- League-V4 provides paginated Emerald and Diamond ladder entries plus Master, Grandmaster, and Challenger league endpoints. Current responses include encrypted PUUIDs.
- Match-V5 lists match IDs by PUUID and returns match details containing queue, game version, participant champion, computed team position, final item slots, and win/loss.
- Data Dragon provides patch-versioned champion and item metadata and public game assets.

There is no global endpoint for all ranked matches. The collector must seed discovery from the eligible ladder population, request each player's current-patch match IDs, and deduplicate the resulting match graph.

A public product requires an approved production API key. A development key is suitable for local prototyping but expires every 24 hours, and a personal key cannot operate a public alpha or beta.

Riot's current policy permits aggregate player statistics but prohibits Arena augment and Arena item win rates. The product will include Riot's required legal boilerplate and remain limited to Ranked Solo Summoner's Rift.

Authoritative references:

- [League of Legends developer documentation](https://developer.riotgames.com/docs/lol)
- [Match-V5 reference](https://developer.riotgames.com/api-details/match-v5)
- [League-V4 reference](https://developer.riotgames.com/api-details/league-v4)
- [API key and rate-limit documentation](https://developer.riotgames.com/docs/portal)
- [General developer policies](https://developer.riotgames.com/policies/general)

## 5. Architecture

The system uses a batch collector and a read-only web path:

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
       versioned aggregate tables
                 |
                 v
   read-only statistics API -> web UI
```

The implementation is a TypeScript workspace containing:

- A Next.js web application for pages and the read-only statistics API
- A separate Node-compatible TypeScript collector process
- PostgreSQL accessed through Drizzle ORM and checked-in SQL migrations
- Shared packages for Riot contracts, database access, item classification, and statistics
- Docker Compose for local PostgreSQL
- Vitest for unit and integration tests
- Playwright for critical browser flows

### Component boundaries

`riot-client` owns Riot HTTP requests, routing, pagination, response validation, rate-limit handling, and retries. It does not know database schemas.

`collector` owns pipeline checkpoints, ladder snapshots, match discovery, eligibility, ingestion, and publication runs. It depends on `riot-client`, domain services, and repositories.

`item-catalog` owns Data Dragon synchronization, item normalization, and versioned include/exclude overrides.

`statistics` owns canonical combination generation, aggregate calculations, Wilson confidence intervals, and invariant checks. It is pure domain logic wherever possible.

`database` owns tables, migrations, transactions, and repositories. It does not contain Riot request logic.

`web` owns champion discovery, explicit role selection, aggregate presentation, sorting, caching, methodology, and status pages. It can read only published aggregate data and public catalog metadata.

## 6. Collection and Publication Flow

Each resumable collection run performs these stages:

1. Read the TR realm descriptor at `https://ddragon.leagueoflegends.com/realms/tr.json` and treat its Data Dragon major/minor pair as the active publishable patch.
2. Synchronize champion and item metadata for that exact version.
3. Fetch the TR1 Ranked Solo ladder:
   - Emerald I–IV and Diamond I–IV through paginated League-V4 entries
   - Master, Grandmaster, and Challenger through their queue-specific endpoints
4. Store a timestamped eligible-player snapshot keyed by PUUID, tier, and division.
5. Request Match-V5 IDs for each PUUID with queue `420`, a conservative 35-day discovery start time, and `count = 100`, paginating until the endpoint is exhausted.
6. Insert discovered match IDs idempotently and enqueue unseen IDs.
7. Fetch match details through the EUROPE regional route.
8. Validate the match and create eligible participant observations transactionally.
9. Recompute only affected champion-role aggregates.
10. Run dataset invariants and atomically advance the published dataset watermark.

Match discovery may find the same match through several participants. `match_id` is globally unique in the database, and `(match_id, participant_id)` is unique for observations.

The patch check uses the first two components of Match-V5 `gameVersion`. The 35-day discovery window is intentionally wider than a normal patch and its exact start is recorded as `coverage_started_at` in the publication. If the TR realm's Data Dragon version is temporarily behind the live game, unmatched games remain unpublished until matching item metadata exists. Only matching-version observations are ever aggregated.

## 7. Eligibility Rules

A participant observation is eligible only when all conditions hold:

- The match platform is TR1.
- `queueId` equals `420`.
- The Match-V5 major/minor version equals the active Data Dragon major/minor version.
- The participant's PUUID occurs in the run's Emerald+ ladder snapshot.
- `teamPosition` maps to top, jungle, middle, bottom, or utility; the public UI labels `UTILITY` as Support.
- No participant marks the match as an early surrender/remake.
- The game duration is at least 300 seconds, which also rejects corrupt or remake-like records missing a reliable flag.

Rank means rank at collection time, not historical rank at the exact match timestamp. The methodology page must disclose this limitation. Normal surrenders remain eligible.

Participants with missing PUUID, champion, win/loss, or role data are rejected with a structured reason. One invalid participant does not invalidate other eligible participants unless match-level fields are invalid.

## 8. Data Model

The canonical model includes:

- `patches`: Data Dragon version, major/minor key, activation and publication state
- `champions`: patch-scoped Riot champion ID, slug, localized name, and asset metadata
- `items`: patch-scoped Riot item ID, normalized base ID, category, name, price, and asset metadata
- `ladder_snapshots`: run, PUUID, queue, tier, division, and capture time
- `collection_runs`: stage checkpoints, counters, health, errors, and publication watermark
- `matches`: unique Match-V5 ID, platform, queue, version, creation time, duration, and validation state
- `participant_observations`: unique match/participant, private PUUID, champion, role, win, rank snapshot, game duration, and raw final slots
- `participant_core_items`: normalized completed core-item multiset for an observation
- `participant_boots`: zero or one normalized upgraded-boots item
- `aggregate_publications`: immutable publication metadata, coverage start, collection time, thresholds, and active/inactive state
- `item_aggregates`: publication, champion, role, item, wins, losses, and sample
- `combination_aggregates`: publication, champion, role, combination size, canonical item multiset, wins, losses, and sample
- `boots_aggregates`: publication, champion, role, boots item, wins, losses, and sample

Raw PUUIDs are private collection identifiers. They are never selected by public repositories. Database access for the web process uses a read-only role restricted to public catalog and published aggregate views.

## 9. Item Classification and Combinations

Data Dragon is the base catalog, augmented by a checked-in, patch-versioned override map for exceptions.

A core item must be purchasable on Summoner's Rift, be a completed build endpoint, and not be a boot, starter, consumable, trinket, quest/support progression item, or mode-specific item. Upgraded boots form their own category. Alternate and upgraded IDs that represent the same core purchase, such as eligible Ornn upgrades, normalize to the base item so statistics are not fragmented.

The classifier records a rejection reason for every excluded final-slot ID. Unknown IDs fail catalog validation and are excluded from aggregates until classified; they are visible in collector health metrics.

Combination keys are sorted multisets of normalized item IDs. Order therefore does not matter, while legitimate duplicate-item cases remain distinguishable. An observation contributes at most once to a given combination. For an inventory with more than the requested number of core items, all contained two-item or three-item multisets are generated.

This means a build rate is the percentage of all eligible champion-role observations containing that combination; percentages across different combinations are not expected to sum to 100%.

## 10. Statistical Definitions

For a fixed publication, champion, and role:

- `baseline_sample` is every eligible participant observation.
- `baseline_win_rate = baseline_wins / baseline_sample`.
- An item's or combination's `sample` is the number of eligible observations containing it.
- `wins` and `losses` are outcomes among that sample.
- `raw_win_rate = wins / sample`.
- `build_rate = sample / baseline_sample`.
- `baseline_delta = raw_win_rate - baseline_win_rate`.
- The displayed uncertainty is a two-sided 95% Wilson score interval for the binomial win proportion.
- The default confidence-adjusted ranking is the lower bound of that 95% Wilson interval.

The default recommendation table includes only results with at least 100 observations. Results below 100 remain accessible when the user enables low-confidence results, have no recommendation rank, and carry a prominent warning. The value is a configurable product constant but is recorded in every publication so old results remain reproducible.

Default sorting uses the confidence-adjusted score. Users may sort by raw win rate, build rate, or sample size. Ties use sample size and then canonical item ID for stable output.

These statistics are correlations. Completed-item results have survivorship and gold-lead bias because winning players generally earn more gold and complete more items. The UI and methodology page state this directly.

## 11. Public API

The read-only web API provides:

- `GET /api/meta`: active patch, fixed scope, coverage start, publication time, public-safe run health, and minimum sample
- `GET /api/champions`: searchable champion catalog with roles present in the active publication
- `GET /api/champions/{championId}`: public champion metadata and available roles; no role statistics without a role parameter
- `GET /api/champions/{championId}/roles/{role}/stats?view=items|pairs|trios|boots&sort=adjusted|winRate|buildRate|sample&includeLowConfidence=false`
- `GET /api/methodology`: versioned public calculation and eligibility metadata

Inputs use allowlisted enums and bounded pagination. Unknown champions or unavailable roles return `404`; invalid parameters return a structured `400`. If no current-patch publication exists, statistics endpoints return `503` with a machine-readable `dataset_warming` code and retry metadata.

Responses include an ETag and cache headers keyed by immutable publication ID. The active publication pointer is resolved server-side.

## 12. User Experience

### Champion discovery

The homepage provides champion search and a champion grid. Selecting a champion opens its statistics page without preselecting a role.

### Champion page

The page requires an explicit top, jungle, middle, bottom, or support selection from the roles available for that champion. After selection it shows:

- Champion identity and selected role
- Permanent scope line: TR1, Ranked Solo, Emerald+, patch, and last update
- Champion-role baseline win rate and eligible-game count
- Tabs for items, two-item builds, three-item builds, and boots
- Sortable columns for adjusted score, raw win rate, baseline difference, build rate, and games
- Item images and names from the active Data Dragon version
- Confidence interval details and a low-confidence control
- A visible correlation warning and methodology link

Unavailable roles show an insufficient-data state rather than borrowing data from another role. Loading, empty, warming, stale, and error states have distinct messages. The fixed scope is never hidden behind a filter menu.

### Supporting pages

- Methodology explains collection scope, eligibility, item classification, formulas, sample thresholds, rank-at-collection semantics, and survivor bias.
- Data status shows the patch, last successful run, current collector stage, data age, and public-safe error status.
- Legal/footer content includes Riot's required non-endorsement boilerplate.

## 13. Failure Handling and Operations

The Riot client reads Riot rate-limit headers and `Retry-After`. A `429` pauses the correct bucket. Network failures and `5xx` responses receive capped exponential backoff with jitter. Repeated `404` responses mark a match unavailable without blocking the run. A `401` or `403` stops collection and reports an invalid or expired key; it is not retried indefinitely.

Pipeline stages checkpoint after idempotent transactions. A process restart resumes the incomplete stage. Structured logs include run ID, stage, endpoint category, routing region, status, attempt, and counts, but never the API key or PUUID.

Publication is atomic. Partial runs remain private. If a refresh fails, the last successfully published current-patch dataset stays live with a stale warning. At patch rollover, old-patch data is never labeled current; the public API reports `dataset_warming` until the new patch passes validation and publication.

Collector health includes:

- Ladder pages and eligible PUUIDs discovered
- Unique matches discovered, fetched, rejected, and pending
- Eligible observations by role and tier
- Unknown item IDs and rejection reasons
- Rate-limit waits and retry counts
- Aggregate invariant failures
- Publication time and data age

## 14. Security and Policy

- `RIOT_API_KEY` is read only by the collector from a server-side environment variable or deployment secret.
- The key is sent through the documented Riot header over HTTPS and is never placed in a URL, repository, client bundle, database row, or log.
- Production uses an approved production key registered for this product.
- The web process uses a separate read-only database credential.
- Public output is aggregate-only and contains no player identifiers or individual match histories.
- Logs redact sensitive headers and identifiers.
- The product includes Riot's required legal notice and avoids Arena item statistics, active-game hidden information, and prescriptive single-choice wording.

## 15. Testing and Data Verification

### Unit tests

- Patch and routing selection
- Queue, patch, rank, duration, remake, and role eligibility
- Data Dragon item classification and override behavior
- Base-item normalization and sorted-multiset combination generation
- Win rate, build rate, baseline delta, Wilson interval, threshold, and stable sorting

### Contract tests

Checked-in sanitized fixtures cover League-V4 entries, apex leagues, Match-V5 match lists and match details, and Data Dragon metadata. Runtime validation fails with a structured schema error when a required upstream field changes.

### Integration tests

Against disposable PostgreSQL, tests cover migrations, unique constraints, idempotent reingestion, participant eligibility, incremental aggregate rebuilding, publication isolation, and atomic watermark advancement.

### Collector behavior tests

A fake Riot HTTP service covers pagination, duplicate discovery, rate-limit headers, `429`, transient `5xx`, unavailable matches, expired keys, checkpoint restart, and patch rollover.

### Browser tests

Playwright verifies champion search, explicit role selection, visible scope, view switching, sorting, low-confidence labels, methodology navigation, warming state, stale state, and responsive table behavior.

### Publication invariants

Before activation, every publication must satisfy:

- `wins + losses = sample` for every aggregate
- Aggregate samples do not exceed their champion-role baseline
- No participant appears twice in the same match
- Every observation matches TR1, queue `420`, the active patch, an allowed role, and the run's Emerald+ snapshot
- Every aggregate item belongs to the active classified catalog
- Recomputing from canonical observations yields the same aggregate rows

Any invariant failure prevents publication.

## 16. Delivery Sequence

Implementation should proceed in vertical milestones:

1. Repository, configuration, PostgreSQL, migrations, and sanitized fixtures
2. Data Dragon catalog and deterministic item classifier
3. Riot client, ladder snapshot, match discovery, and resumable ingestion
4. Eligibility, participant observations, combinations, statistics, and atomic publication
5. Read-only API and cache behavior
6. Champion discovery, explicit role flow, statistics tables, methodology, and status UI
7. Full verification, prototype data run with the user's environment-provided development key, and production-readiness documentation

Hosting-provider selection is deliberately deferred because it does not change the component interfaces or data model. Any deployment must support a long-running or scheduled worker, PostgreSQL, server-side secrets, and HTTPS.
