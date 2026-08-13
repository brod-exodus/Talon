# Talon five-minute portfolio demo

This demonstration uses only public GitHub data and shows why Talon's scraping
architecture is more than a long-running web request. It is designed for a
technical reviewer, hiring manager, or collaborator watching the operator use
the deployed app.

## What the demo proves

- Starting work is fast because the API validates and queues the scrape instead
  of holding the browser request open.
- A scheduled, bounded worker resumes durable state until the scrape finishes.
- Replayed work is idempotent, so interrupted steps do not duplicate
  contributors.
- Contributor results load progressively and export as a correctly labelled
  CSV.
- Scheduling, database access, GitHub access, queue state, and failures remain
  visible inside Talon after ephemeral platform logs expire.
- A share link exposes a read-only view without exposing Talon's operator
  controls.

## Before the call

1. Sign in with an operator account and open **Settings**.
2. Refresh **Production Readiness**. Confirm the database and GitHub checks are
   green, the latest scrape worker run succeeded recently, and the queue has no
   stale jobs.
3. Open **Dashboard** in a second tab.
4. Keep contributor lists collapsed until the live walkthrough. Never screen
   share recruiter notes, private repositories, secrets, audit identifiers, or
   downloaded contact data.

The public `expressjs/express` repository is the canonical target. Select a
minimum contribution count of `1`. Public contributor totals and completion
time will vary as GitHub changes and as free-tier scheduling conditions change.

## Live walkthrough

### 1. Queue a scrape

On **Dashboard**, choose **Repository**, enter `expressjs/express`, and select
**Start Scrape**.

Point out that the page responds with a queued job instead of waiting for the
entire GitHub crawl. Refresh the page, navigate elsewhere, or briefly close the
tab to demonstrate that the browser does not own the job.

### 2. Watch durable progress

Return to **Dashboard** and show the queued or running card advancing. Explain
that the job stores its phase and cursor in Supabase, while each invocation
performs a bounded amount of discovery or profile hydration.

If an invocation is interrupted, the next scheduled run resumes the saved
state. Contributor upserts and persisted-login checks make replay safe.

### 3. Inspect the completed list

Open **View Contributors** when the card completes. Show the first page arriving
before later pages, then demonstrate one contact-channel filter and one public
profile. Avoid opening personal notes during a recorded or public demo.

Download **CSV** and explain that Talon intentionally removed its former fake
`.xlsx` option: the file extension now matches the actual format.

### 4. Demonstrate safe sharing

Create a share link, open it in a private window, and confirm that the page is
read-only. Revoke the link after the demonstration unless it is intentionally
being retained as a public artifact.

### 5. Close with operations visibility

Return to **Settings → Production Readiness** and show:

- the recent successful worker invocation;
- the empty queue and absence of stale locks;
- healthy database and GitHub access;
- remaining GitHub API capacity; and
- the persistent keepalive result.

This is the architectural close: browser requests create jobs, Supabase stores
durable state, scheduled workers call GitHub in bounded steps, and Talon records
the operational outcome.

## Reproducible automated check

After a deployment, the operator can run the destructive-but-self-cleaning
production smoke from the repository root:

```bash
BASE_URL="https://github-scraper-v2.vercel.app" \
ADMIN_EMAIL="operator@example.com" \
ADMIN_PASSWORD="..." \
SMOKE_REPO="octocat/Hello-World" \
pnpm smoke:production
```

The script verifies scheduling, cancellation, retry, completion, contributor
loading, CSV generation, and read-only sharing. It removes its scrape and share
artifacts on success. Add `CRON_SECRET="..."` only when directly exercising the
protected keepalive route as part of the same check.

## Cleanup

Delete the demonstration scrape if it is no longer useful, revoke temporary
share links, and remove any downloaded CSV before presenting or recording the
next session.
