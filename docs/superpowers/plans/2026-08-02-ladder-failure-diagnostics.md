# Ladder Failure Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify whether Railway's `LADDER` failure occurs during Riot fetching, database persistence, or stage checkpointing without exposing private data.

**Architecture:** Extend the existing snapshot service with optional structured lifecycle logging and pass the existing allowlisted collector logger into it. Extend failure reporting with a strictly validated code obtained from the error cause chain; do not change collection, retry, persistence, or publication behavior.

**Tech Stack:** Bun, TypeScript, Vitest, Pino, Next.js monorepo

## Global Constraints

- Never log Riot API keys, request paths, PUUIDs, database URLs, exception messages, or arbitrary exception values.
- Lifecycle events may contain only the run ID, stage, static event name, and aggregate eligible-player count.
- Diagnostic codes must match `^[A-Z0-9_]{1,64}$`.
- Do not change Riot request behavior, database persistence behavior, retry policy, or publication behavior.

---

### Task 1: Ladder lifecycle telemetry

**Files:**
- Modify: `apps/collector/src/services/snapshot-ladder.test.ts`
- Modify: `apps/collector/src/services/snapshot-ladder.ts`
- Modify: `apps/collector/src/commands/collect.ts`

**Interfaces:**
- Consumes: existing structured logger methods accepting `Record<string, unknown>`.
- Produces: optional `logger` on `SnapshotLadderInput` and four lifecycle events containing `event`, `runId`, `stage`, and optionally `aggregateCount`.

- [x] **Step 1: Write failing lifecycle tests**

Add tests that pass an in-memory logger, assert exact event order for success, assert `ladder_fetch_started` is last when fetching fails, and assert `ladder_persist_started` is last when persistence fails. Assert serialized fields contain neither a fixture PUUID nor a secret exception message.

- [x] **Step 2: Run the focused test and verify RED**

Run: `bunx vitest run apps/collector/src/services/snapshot-ladder.test.ts`

Expected: failure because `SnapshotLadderInput` does not accept or emit through `logger`.

- [x] **Step 3: Implement minimal lifecycle logging**

Add an optional logger interface to `SnapshotLadderInput`. Emit `ladder_fetch_started`, `ladder_fetch_completed`, `ladder_persist_started`, and `ladder_persist_completed` at their respective boundaries. Pass `logger` from the production `LADDER` handler.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `bunx vitest run apps/collector/src/services/snapshot-ladder.test.ts`

Expected: all snapshot-ladder tests pass.

### Task 2: Sanitized terminal diagnostic code

**Files:**
- Modify: `apps/collector/src/pipeline.test.ts`
- Modify: `apps/collector/src/pipeline.ts`
- Modify: `apps/collector/src/logger.test.ts`
- Modify: `apps/collector/src/logger.ts`

**Interfaces:**
- Consumes: an error cause chain whose nodes may contain `code`.
- Produces: `diagnosticCode` on `collection_failed`, only when a cause has a code matching `^[A-Z0-9_]{1,64}$`.

- [x] **Step 1: Write failing code-propagation and redaction tests**

Add a pipeline test with an outer wrapper and inner `{ code: "57014" }`, asserting the terminal log contains `diagnosticCode: "57014"`. Add logger coverage proving `diagnosticCode` survives while a lowercase/private code and secret fields do not.

- [x] **Step 2: Run focused tests and verify RED**

Run: `bunx vitest run apps/collector/src/pipeline.test.ts apps/collector/src/logger.test.ts`

Expected: failure because terminal logs and the logger allowlist do not support `diagnosticCode`.

- [x] **Step 3: Implement strict cause-chain extraction**

Walk the cause chain with cycle protection, return the first code matching `^[A-Z0-9_]{1,64}$`, add `diagnosticCode` to the terminal event only when present, and add that exact field to the logger allowlist.

- [x] **Step 4: Run focused tests and verify GREEN**

Run: `bunx vitest run apps/collector/src/pipeline.test.ts apps/collector/src/logger.test.ts`

Expected: all focused tests pass without secrets in output.

### Task 3: Full verification and deployment

**Files:**
- Verify all modified files and documentation.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: a tested commit pushed to `origin/master` for Railway deployment.

- [x] **Step 1: Run full verification**

Run `bun run test`, `bun run typecheck`, `bun run build`, and `git diff --check`. All commands must exit 0.

- [x] **Step 2: Review the diff for scope and redaction**

Confirm only diagnostic behavior changed and no secret-bearing fields or arbitrary exception strings can reach Pino.

- [x] **Step 3: Commit and push**

Commit the plan and implementation with `fix: expose safe ladder failure boundary`, then push `master` to `origin` and verify local and remote commit IDs match.
