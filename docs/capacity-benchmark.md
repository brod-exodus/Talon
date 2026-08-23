# Talon capacity benchmark

This deterministic harness turns Talon's repository worker limits into a
repeatable capacity model. It is a regression gate, not a claim about live
GitHub or Vercel performance.

Run it from the repository root:

```bash
pnpm benchmark:capacity
pnpm benchmark:capacity -- --json
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
- Worker limit: 20 steps or 40 seconds per invocation.
- Scheduler interval: one minute.
- Cold profile: two GitHub requests, one for profile details and one for social
  accounts.

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
Production Readiness provides the real seven-day evidence. A later concurrency
benchmark should use controlled adapters around the queue and worker leases;
production load tests must remain explicitly operator-triggered and use public,
non-sensitive targets.
