## Summary

Describe what changed and why.

## Validation

- [ ] `pnpm verify` passes locally
- [ ] `pnpm build` passes locally (with required env vars)
- [ ] Added or updated tests for behavior changes

## Production Checklist

- [ ] Required DB migrations were applied (list files below)
- [ ] Vercel env vars are present and correct for this change
- [ ] `/api/health` is `ok` after deploy
- [ ] Post-deploy smoke checks completed

## Migrations Applied

- [ ] None
- [ ] `db/migrations/_____`

## Smoke Checks

- [ ] Start scrape: queued -> running -> completed
- [ ] Failed scrape: retry path works
- [ ] Delete scrape updates immediately
- [ ] Watched repo `Check Now` updates `last checked`
- [ ] Share link works in private window
