# Ladder Failure Diagnostics Design

## Problem

The Railway collector repeatedly spends approximately 26–28 minutes in the
`LADDER` stage and then exits with code 1. The migration completes normally,
but the existing allowlisted logger records only the stage and broad failure
category. It therefore cannot distinguish a Riot ladder-fetch failure from a
database snapshot failure.

## Goal

Make the next production run identify which side of the ladder boundary fails,
without logging Riot API keys, request paths, PUUIDs, database URLs, exception
messages, or other private values.

## Design

The ladder snapshot service will accept the existing collector logger as an
optional dependency and emit four allowlisted lifecycle events:

- `ladder_fetch_started`
- `ladder_fetch_completed`, including only the aggregate eligible-player count
- `ladder_persist_started`, including only the same aggregate count
- `ladder_persist_completed`, including only the same aggregate count

On failure, the pipeline's existing `collection_failed` event remains the
terminal event. Its safe fields will include an allowlisted diagnostic code
derived by walking the error cause chain. Only short uppercase alphanumeric
codes are eligible, such as a PostgreSQL SQLSTATE or the collector's static
error code. Messages and arbitrary exception data remain prohibited.

The production collector will pass its existing structured logger into the
snapshot service. No Riot request behavior, database write behavior, retry
policy, or publication behavior changes in this diagnostic deployment.

## Interpretation

- No `ladder_fetch_completed`: investigate the Riot response or HTTP client.
- `ladder_fetch_completed` followed by no `ladder_persist_completed`:
  investigate and optimize the database snapshot transaction.
- Both completion events followed by failure: investigate stage checkpointing.

## Testing

Service tests will verify the lifecycle event order for a successful snapshot
and the last emitted event for fetch and persistence failures. Pipeline/logger
tests will verify that safe diagnostic codes survive sanitization while secret
fields and exception messages remain absent. Existing collector and repository
tests must continue to pass, followed by the workspace typecheck and production
web build.

## Deployment and Success Criteria

After the commit is pushed to `master`, Railway will redeploy the collector.
The first subsequent failure must identify the failing boundary through the
last lifecycle event and expose only a sanitized code. That evidence will be
used for a separate, targeted behavior fix.
