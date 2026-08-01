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
already durably ingested are not fetched again. A crash before a match row is
committed may cause that match to be fetched again; the checkpoint boundary is
at durable match ingestion, not at the network request.

`bun run collector:health -- --json` emits only the active patch, run status,
stage, data age, safe counters, unknown-item count, and a public error
category. It does not emit private error details, PUUIDs, request paths,
authorization headers, Riot keys, or database credentials. When the database
is unavailable it prints deterministic `UNAVAILABLE` JSON and exits `1`.
