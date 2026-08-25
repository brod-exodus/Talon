# Talon capacity benchmark

This deterministic harness turns Talon's repository worker limits into a
repeatable capacity model. It is a regression gate, not a claim about live
GitHub or Vercel performance.

Run it from the repository root:

```bash
pnpm benchmark:capacity
pnpm benchmark:capacity -- --json
pnpm benchmark:concurrency
pnpm benchmark:concurrency -- --json
```

The default cold-cache scenarios cover 100, 400, 1,000, and 5,000 contributors.
For each size the report includes contributor discovery pages, hydration
batches, estimated GitHub requests, bounded worker invocations, execution time,
scheduler wait, and total modeled completion time. CI stores the JSON report as
a short-lived artifact and fails when a documented budget regresses.

## Model inputs

The defaults mirror production constants:

- GitHub contributor discovery: 100 contributors per page.
- Contributor hydration: 20 profiles per durable batch.
- Worker limit: 40 seconds, 850 estimated GitHub requests, or a defensive 100
  steps per invocation—whichever is reached first.
- Scheduler interval: one minute.
- Cold profile: two GitHub requests, one for profile details and one for social
  accounts.

Request weighting assigns one request to a contributor-discovery page and 40
requests to a worst-case cold 20-profile hydration batch. This allows cheap
discovery and expensive hydration to share one invocation without crossing
GitHub's documented 900-point-per-minute secondary limit.

Controlled durations are 300 ms per discovery step and 1.2 seconds per
hydration step. These values keep the calculation deterministic; they do not
pretend to measure provider latency. The first claim uses the worst-case
one-minute scheduler interval.

Default completion budgets are:

| Contributors | Synthetic budget |
| ---: | ---: |
| 100 | 3 minutes |
| 400 | 3 minutes |
| 1,000 | 5 minutes |
| 5,000 | 25 minutes |

The 100- and 400-contributor budgets align with Talon's interactive product
goal. Larger cases establish capacity boundaries rather than the same user
experience promise.

## How to interpret a regression

- More discovery pages indicates a change to provider pagination assumptions.
- More hydration batches indicates smaller database checkpoints.
- More invocations with unchanged steps indicates tighter execution budgets or
  slower modeled steps.
- More GitHub requests indicates weaker profile-cache reuse or additional
  enrichment calls.
- More scheduler wait indicates that a job now spans additional invocations.

Update a budget only when a PR explains the architectural tradeoff. Do not tune
controlled durations to make a regression pass.

## What this does not prove

The harness does not call GitHub, Supabase, or Vercel. It cannot measure network
variance, database contention, rate-limit responses, or multi-job fairness.
Production Readiness provides the real seven-day evidence. The companion
benchmark below uses a deterministic queue adapter to exercise scheduling and
lease contracts without touching production. Production load tests must remain
explicitly operator-triggered and use public, non-sensitive targets.

## Worker concurrency benchmark

The companion concurrency benchmark models four failure boundaries that a
single-job throughput calculation cannot cover:

- simultaneous workers receive at most one lease for one queued job;
- workspaces rotate and a background check waiting 15 minutes is promoted;
- an interrupted lease is recovered while the stale worker's late completion is
  rejected;
- a token-wide GitHub cooldown blocks every claim without consuming attempts,
  then releases work at its boundary.

The model mirrors migrations 030, 037, and 047 and fails CI when any invariant
changes. CI stores its JSON result for seven days beside the capacity report.
It is deliberately not a database or production load test: SQL migration
contract tests cover the real functions structurally, while Production
Readiness remains the source of live operational evidence.
