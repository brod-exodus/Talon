## Summary

Describe what changed and why.

## Release Ownership

- [ ] Release owner assigned: `@______`
- [ ] Rollback owner assigned: `@______`
- [ ] Rollback plan documented below

## Rollback Plan

Describe how to quickly roll this back if the deploy is unhealthy.

## Validation

- [ ] `pnpm verify` passes locally
- [ ] `pnpm build` passes locally (with required env vars)
- [ ] Added or updated tests for behavior changes

## Production Checklist

- [ ] Required DB migrations were applied (required to merge when this PR adds a migration; list every file below)
- [ ] Settings reports `Database Schema` healthy after deployment
- [ ] Vercel env vars are present and correct for this change
- [ ] `/api/health` is `ok` after deploy
- [ ] Repository scrape reliability and latency SLOs were reviewed
- [ ] Post-deploy smoke checks completed

## Migrations Applied

- [ ] None
- [ ] `db/migrations/_____`

For a migration PR, apply every listed file to Production, replace the placeholder
with each exact path, and only then check **Required DB migrations were applied**.
Editing this PR description reruns the release gate.

## Environment Changes

- [ ] None
- [ ] Variables added or changed (names only): `_____`

## Smoke Checks

- [ ] Start scrape: queued -> running -> completed
- [ ] Failed scrape: retry path works
- [ ] Delete scrape updates immediately
- [ ] Watched repo `Check Now` updates `last checked`
- [ ] Share link works in private window

## Smoke Result

Record the deployment URL, timestamp, operator, and result:

`_____`
