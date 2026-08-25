# Talon product and engineering roadmap

Updated: August 2026

Talon already has a strong reliability and security foundation: durable bounded
workers, workspace isolation, server-managed secrets, resumable GitHub work,
safe sharing, recovery runbooks, production health evidence, and broad invariant
tests. The roadmap therefore prioritizes recruiter usefulness and complete user
workflows before adding more infrastructure or speculative intelligence.

Ranking considers user value, risk reduction, effort, and strategic importance.
Effort is a rough engineering estimate for one experienced contributor.

## Now

### 1. Show every discovered contributor in completed results — completed

- **User problem:** Talon reports the total number of discovered contributors,
  but the authenticated completed list currently requests and displays only
  contributors with contact information. Relevant engineers without public
  contact fields cannot be searched, previewed, added to a list, or opened in
  GitHub/Merged PRs.
- **Outcome:** Show all contributors by default, with contact-channel filters for
  recruiters who want a contactable subset. Keep CSV export and public sharing
  contact-focused unless intentionally changed later.
- **Why it matters:** This unlocks contributor intelligence Talon already paid
  to collect and makes GitHub evidence useful even when a profile has no email.
- **Effort / risk:** Small (1–2 days) / low. No schema or GitHub API change.
- **Dependencies:** Existing all-contributor pagination route and bounded UI
  rendering.
- **Acceptance:** The list button uses the total contributor count; a completed
  scrape loads all contributors; contact filters narrow the list correctly; a
  contributor without contact data still has Preview, GitHub, Merged PRs, and
  list actions; CSV continues to contain only contactable contributors.
- **Delivered:** The authenticated completed-results workflow now meets these
  criteria. Public sharing remains contact-focused by design.

### 2. Add safe self-service password recovery

- **User problem:** A user who forgets a password must ask an owner to set a
  temporary password and share it out of band.
- **Outcome:** Add a non-enumerating “Forgot password” request and secure reset
  flow, then configure and verify production email delivery.
- **Why it matters:** Account recovery is a basic expectation for real users and
  reduces insecure temporary-password handling.
- **Effort / risk:** Medium (3–5 days) / medium because recovery tokens and email
  redirects are security-sensitive.
- **Dependencies:** Supabase SMTP provider, authenticated sender domain, email
  templates, and redirect allowlist. Keep self-service signup closed.
- **Acceptance:** Existing users can request and complete a time-limited reset;
  unknown emails receive the same response; tokens cannot be reused; other
  sessions are revoked after reset; route, browser, and production email checks
  pass.

### 3. Clarify the recruiter workflow and state ownership

- **User problem:** Talon has global contributor status/notes plus project-level
  outreach status, lists, reminders, Pipeline, and Follow-ups. The UI does not
  clearly explain which state applies everywhere and which applies only inside
  a project.
- **Outcome:** Define one primary sourcing workflow and make labels, empty
  states, and navigation consistently guide users from scrape → project/list →
  outreach → follow-up.
- **Why it matters:** Strong features create little value when users cannot form
  a dependable mental model of the workflow.
- **Effort / risk:** Medium (3–5 days) / medium; careless changes could confuse
  existing saved state.
- **Dependencies:** A written state-ownership decision and an inventory of every
  contributor-editing surface.
- **Acceptance:** Each editable field has one documented owner; identical terms
  are used across completed results, Projects, contributor profiles, Pipeline,
  and Follow-ups; a first-time operator can complete the workflow without the
  external runbook; existing records remain compatible.

### 4. Establish an accessibility and mobile acceptance baseline

- **User problem:** Responsive classes and keyboard primitives exist, but CI has
  no automated accessibility check and only three desktop Chromium scenarios.
  Dense candidate tables and action groups are not protected against mobile or
  keyboard regressions.
- **Outcome:** Add automated critical-page accessibility checks and narrow/mobile
  browser coverage, then repair verified high-impact failures.
- **Why it matters:** Recruiters work across laptops and smaller screens, and an
  accessible product is more credible and usable.
- **Effort / risk:** Medium (2–4 days) / low.
- **Dependencies:** Choose a maintained accessibility checker compatible with
  Playwright; avoid a broad visual redesign.
- **Acceptance:** Login, Dashboard results, Projects, Pipeline, Settings, and a
  public share have no serious automated accessibility violations; critical
  actions work at a 390px viewport and by keyboard; CI prevents regressions.

## Next

### 5. Add privacy-aware data lifecycle controls

- **User problem:** Operational records have retention rules, but contributor
  profiles, public contact data, recruiter notes, and outreach history otherwise
  persist until their containing records are manually deleted.
- **Outcome:** Give owners clear workspace export/deletion controls and document
  retention choices for recruiter-managed data.
- **Why it matters:** Real-user readiness requires predictable data ownership and
  deletion, especially for notes and contact information.
- **Effort / risk:** Large (1–2 weeks) / high because deletion crosses shared
  contributors, projects, audit history, and Supabase Auth.
- **Dependencies:** Product retention policy, legal/privacy review appropriate to
  the deployment, backup interaction, and transactional deletion design.
- **Acceptance:** Owners can preview scope, export their workspace, delete it with
  deliberate confirmation, and verify no cross-workspace or public-share data
  remains; audit and backup limitations are documented.

### 6. Validate real queue capacity and fairness under concurrency

- **User problem:** Talon has a deterministic capacity model and production SLOs,
  but no controlled integration test for overlapping workspaces, workers, rate
  limits, and lease recovery.
- **Outcome:** Add a provider-adapter concurrency harness that proves fairness,
  idempotency, and bounded resource use without load-testing production.
- **Why it matters:** It closes the largest gap between the strong queue design
  and evidence that it behaves correctly under contention.
- **Effort / risk:** Medium–large (1 week) / medium.
- **Dependencies:** Durable-worker invariants, deterministic GitHub adapter, and
  isolated database test environment.
- **Acceptance:** Concurrent claims never duplicate completion; aged background
  work progresses; workspace rotation is measurable; rate-limit cooldown pauses
  all affected work; interrupted leases recover within the documented bound.

### 7. Improve candidate evidence without scoring people

- **User problem:** Contribution totals and Merged PR links help, but recruiters
  still need to manually understand where a person contributed across a Project.
- **Outcome:** Show factual repository-level contribution breakdowns and direct
  links to public GitHub evidence, without AI summaries or opaque rankings.
- **Why it matters:** It makes candidate review faster while preserving Talon’s
  evidence-first, operator-controlled philosophy.
- **Effort / risk:** Medium (3–5 days) / low–medium.
- **Dependencies:** Existing job-scoped contribution data and a privacy review of
  public-share exposure.
- **Acceptance:** A Project contributor shows deterministic per-repository totals
  and scope-correct GitHub links; totals reconcile with stored contributions;
  no new GitHub requests occur when viewing results.

### 8. Finish teammate invitation and email onboarding

- **User problem:** Owners can create accounts, but onboarding still relies on a
  temporary password instead of an auditable invitation lifecycle.
- **Outcome:** Add expiring owner-issued invitations after password recovery and
  production email delivery are proven.
- **Why it matters:** This is the cleanest path from operator-only demo to a small
  real recruiting team without opening public registration.
- **Effort / risk:** Medium–large (1 week) / medium–high.
- **Dependencies:** Roadmap item 2, invitation state, email delivery monitoring,
  and owner-only authorization.
- **Acceptance:** Invitations expire, are single-use and workspace-bound; role is
  fixed by the owner; revoked invitations fail closed; acceptance creates one
  membership; audit history contains no raw email or token.

## Later

### 9. Privacy-preserving product usage evidence

- **User problem:** Talon measures system reliability but not whether recruiters
  reach valuable outcomes such as building a shortlist or scheduling follow-up.
- **Outcome:** Add opt-in aggregate workflow metrics with no repository targets,
  contributor identities, notes, or contact data.
- **Why it matters:** Product decisions should be based on workflow evidence, not
  feature count.
- **Effort / risk:** Medium / medium due to privacy and metric-definition risk.
- **Dependencies:** Stable primary workflow from item 3 and explicit operator
  consent.
- **Acceptance:** Funnel counts reconcile with documented events, can be disabled,
  contain no sensitive dimensions, and identify the largest workflow drop-off.

### 10. Explore ecosystem relationships and contributor movement

- **User problem:** Projects aggregate contributors but do not show durable
  relationships between repositories or changes in contributor activity over
  time.
- **Outcome:** Prototype an evidence-based ecosystem graph or migration view
  using already-collected public snapshots.
- **Why it matters:** This could differentiate Talon for ecosystem discovery, but
  value should be proven before adding graph infrastructure.
- **Effort / risk:** Large / high product and data-model uncertainty.
- **Dependencies:** Usage evidence, snapshot semantics, explainable visualization,
  and retention/privacy decisions.
- **Acceptance:** A prototype answers a specific operator question faster than
  current Projects, every edge is traceable to stored public evidence, and no
  inference is presented as fact.

### 11. Evaluate selective recruiting integrations

- **User problem:** Real teams may eventually need handoff to an ATS or messaging
  system, but premature integrations create security and maintenance cost.
- **Outcome:** Add only the single export or integration proven most valuable by
  operator usage; keep external writes explicit and reviewable.
- **Why it matters:** Integration can reduce duplicate entry after Talon’s core
  workflow is proven, but it is not the current differentiator.
- **Effort / risk:** Medium–large / high because external credentials and writes
  expand the trust boundary.
- **Dependencies:** Item 9 evidence, provider selection, permission model, audit,
  retries, and deletion behavior.
- **Acceptance:** A documented user need justifies the integration; least-privilege
  permissions are used; retries are idempotent; every external write is visible
  and operator-triggered.

## Explicitly not prioritized

Billing, public self-service signup, AI candidate scoring, opaque recommendations,
high-volume parallel scraping, and a built-in pull-request viewer are deferred.
They add cost, risk, or product ambiguity without improving the current
operator-controlled sourcing workflow enough to justify them.
