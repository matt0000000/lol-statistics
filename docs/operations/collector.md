# Collector operations

The collector targets TR1 ranked solo (`420`) and Match-V5 Europe. Configure
`DATABASE_URL`, `RIOT_API_KEY`, `RIOT_PLATFORM=TR1`, and `RIOT_REGION=EUROPE`.
Never put a Riot key or database URL in scheduler output.

Run `bun run collect` from the deployment directory. Migrations are opt-in:
use `bun run collect -- --migrate` during a controlled release. A normal run
resumes the durable CATALOG → LADDER → DISCOVERY → MATCHES → AGGREGATES →
VERIFY → PUBLISH state machine. Completed stages are not repeated. Failed runs
resume only when the active patch, 35-day coverage window, and minimum sample
of 100 match the original run.

Each run persists its exact `coverageStartedAt` at creation. That timestamp is
used for Riot discovery, aggregate rebuilds, and publication verification; it
is not recomputed when a process resumes. Riot Match-V5 rejects discovery
starts older than 35 days. If a resumable run is already older than that limit
when the scheduler executes (the exact 35-day boundary is still admissible),
the run is terminally marked `FAILED` with the public-safe
`stale_coverage`/`COVERAGE_WINDOW_EXPIRED` reason and a fresh run is created.
This prevents an invalid `startTime` or an infinite stale-resume loop.

The CLI constructs the real Riot and Data Dragon clients and runs every stage
through repository-backed discovery, ingestion, aggregate, verification, and
publication services. A completed run is scheduler-idempotent only while its
owned publication remains active; a stale completed run fails closed for
operator inspection.

Exit codes are stable for schedulers: `0` success, `2` authentication or an
expired development key, `3` publication invariant failure, and `4` exhausted
transient/rate-limit failure. Other configuration or database failures return
`1`. Development keys are unsuitable for hourly production collection; use a
production Riot key with the required regional permissions.

Schedule one run hourly. Overlap is prevented by a PostgreSQL advisory lock;
the lock is released in a `finally` path on success, failure, and process
errors. If a process is terminated, PostgreSQL releases its session lock and
the next invocation can safely resume persisted checkpoints. Canonical matches
already durably ingested as `VALID` are not fetched again. Matches recorded as
`REJECTED` remain eligible for refetch in a later run, so a new ladder snapshot
can re-evaluate rank/eligibility and promote the match to `VALID` without
duplicating accepted participant observations. Within one run, the
discovered-match checkpoint is marked processed after ingestion (including
deterministic rejection), preventing endless retries after a crash. A crash
before that checkpoint or before a match row is committed may cause one
refetch; the checkpoint boundary is at durable match ingestion.

Participant rank and division are evaluated from the ladder snapshot captured
for that collection run. Re-evaluation in a later run therefore uses the later
snapshot, while published aggregate rows retain the rank-at-collection values
from accepted observations.

`bun run collector:health -- --json` emits only the active patch, run status,
stage, data age, safe counters, unknown-item count, and a public error
category. It does not emit private error details, PUUIDs, request paths,
authorization headers, Riot keys, or database credentials. When the database
is unavailable it prints deterministic `UNAVAILABLE` JSON and exits `1`.
