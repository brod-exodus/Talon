# Talon product and engineering roadmap

Updated: August 2026

Talon's primary job is to turn public GitHub contribution activity into a fast,
focused list of candidates a recruiter can actually contact. Completed scrape
results therefore remain contact-focused: repository contributor totals provide
context, while the actionable list contains people with public contact details.

Talon already has a strong engineering foundation: durable bounded workers,
workspace isolation, server-managed secrets, resumable GitHub work, safe
sharing, recovery runbooks, production health evidence, and broad invariant
tests. This roadmap prioritizes recruiter usefulness and complete workflows over
more infrastructure or speculative intelligence.

Ranking considers user value, risk reduction, effort, and strategic importance.
Effort is a rough estimate for one experienced engineer.

## Completed

### Clarify the recruiter workflow and state ownership

- **User problem:** Talon has global contributor status and notes, project-level
  outreach state, lists, reminders, Pipeline, and Follow-ups. The product does
  not clearly explain which state applies everywhere and which belongs to one
  project.
- **Delivered:** Defined and documented the Discover → Organize → Outreach
  workflow, made it visible on the Dashboard, Projects, and Pipeline, and
  clarified contributor-wide versus Project-specific state without migrating or
  changing existing records.
- **Why it matters:** Powerful features create little value when recruiters
  cannot form a dependable mental model of the product.
- **Evidence:** `docs/recruiter-workflow.md` owns the field-level contract;
  product labels distinguish Contributor notes and reminders from Project
  outreach status, notes, contact dates, and follow-ups.

## Now

### 1. Make contactable candidate review faster

- **User problem:** A completed scrape finds actionable people, but recruiters
  still open multiple surfaces to judge relevance and organize a shortlist.
- **Outcome:** Consolidate the most useful public evidence and explicit shortlist
  actions in the completed-result review flow without scoring or ranking people
  opaquely.
- **Why it matters:** This directly improves Talon's core promise: move from a
  repository to qualified, contactable candidates quickly.
- **Effort / risk:** Medium (3–5 days) / low–medium.
- **Dependencies:** Item 1's workflow decision and existing public GitHub,
  contribution, profile-preview, Merged PRs, and list data.
- **Acceptance:** A recruiter can review public evidence, identify available
  contact channels, and save or dismiss a candidate without losing their place;
  no additional GitHub request is required to reopen stored evidence; keyboard
  operation and clear loading/error states are covered by browser tests.

### 2. Establish an accessibility and mobile acceptance baseline

- **User problem:** Responsive classes and keyboard primitives exist, but CI has
  no automated accessibility check and only desktop Chromium coverage. Dense
  candidate actions are not protected against narrow-screen or keyboard
  regressions.
- **Outcome:** Add automated checks for critical pages and narrow/mobile browser
  coverage, then repair verified high-impact failures.
- **Why it matters:** Recruiting work happens across laptops and smaller screens,
  and accessibility is part of product credibility.
- **Effort / risk:** Medium (2–4 days) / low.
- **Dependencies:** A maintained Playwright-compatible accessibility checker;
  avoid turning this into a visual redesign.
- **Acceptance:** Login, completed results, Projects, Pipeline, Settings, and a
  public share have no serious automated accessibility violations; critical
  actions work at a 390px viewport and by keyboard; CI prevents regressions.

## Next

### 3. Add safe self-service password recovery

- **User problem:** A user who forgets a password must ask an owner to set and
  communicate a temporary password.
- **Outcome:** Add a non-enumerating reset request and secure, time-limited reset
  flow while keeping public registration closed.
- **Why it matters:** Account recovery is expected by real users and reduces
  insecure temporary-password handling.
- **Effort / risk:** Medium (3–5 days) / medium because tokens, redirects, email,
  and session revocation are security-sensitive.
- **Dependencies:** A configured Supabase SMTP provider, authenticated sender
  domain, recovery template, production redirect allowlist, and delivery test.
- **Acceptance:** Existing users can request and complete one time-limited reset;
  unknown emails receive the same response; used tokens fail; all existing Talon
  sessions are revoked; route, browser, and production email checks pass.

### 4. Add privacy-aware data lifecycle controls

- **User problem:** Contributor contacts, recruiter notes, and outreach history
  otherwise persist until their containing records are manually deleted.
- **Outcome:** Give owners clear workspace export and deliberate deletion
  controls, with documented retention behavior.
- **Why it matters:** Real-user readiness requires predictable ownership of
  recruiting data, especially notes and contact information.
- **Effort / risk:** Large (1–2 weeks) / high because deletion crosses shared
  contributors, projects, audit history, authentication, and backups.
- **Dependencies:** A retention policy, backup interaction, transactional design,
  and privacy review appropriate to the deployment.
- **Acceptance:** Owners can preview scope, export their workspace, delete it
  deliberately, and verify no workspace or public-share data remains; audit and
  backup limitations are documented.

### 5. Validate queue capacity and fairness under real concurrency

- **User problem:** Talon has a deterministic capacity model and production SLOs,
  but no controlled integration test for overlapping workspaces, workers, rate
  limits, and lease recovery.
- **Outcome:** Add an isolated provider-adapter harness that proves fairness,
  idempotency, and bounded resource use without load-testing production.
- **Why it matters:** It closes the largest remaining evidence gap in Talon's
  otherwise strong durable-worker design.
- **Effort / risk:** Medium–large (1 week) / medium.
- **Dependencies:** A deterministic GitHub adapter and isolated database test
  environment.
- **Acceptance:** Concurrent claims never duplicate completion; aged background
  work progresses; workspace rotation is measurable; cooldown pauses affected
  work; interrupted leases recover within the documented bound.

### 6. Finish teammate invitations and email onboarding

- **User problem:** Owners can create accounts, but onboarding relies on a
  temporary password instead of an auditable invitation lifecycle.
- **Outcome:** Add expiring, owner-issued invitations after password recovery and
  production email delivery are proven.
- **Why it matters:** This supports a small real recruiting team without opening
  public registration.
- **Effort / risk:** Medium–large (1 week) / medium–high.
- **Dependencies:** Item 4, invitation state, email monitoring, and owner-only
  authorization.
- **Acceptance:** Invitations expire, are single-use and workspace-bound; the
  owner fixes the role; revoked invitations fail closed; acceptance creates one
  membership; audit records contain no raw email or token.

## Later

### 7. Privacy-preserving product usage evidence

- **User problem:** Talon measures system reliability but not whether recruiters
  reach outcomes such as creating a shortlist or scheduling follow-up.
- **Outcome:** Add opt-in aggregate workflow metrics with no repository target,
  contributor identity, notes, or contact data.
- **Why it matters:** Future product decisions should follow workflow evidence,
  not feature count.
- **Effort / risk:** Medium / medium due to privacy and metric-definition risk.
- **Dependencies:** A stable primary workflow from item 1 and explicit operator
  consent.
- **Acceptance:** Funnel counts reconcile with documented events, can be
  disabled, contain no sensitive dimensions, and reveal the largest workflow
  drop-off.

### 8. Explore ecosystem relationships and contributor movement

- **User problem:** Projects aggregate contributors but do not show durable
  repository relationships or changes in contributor activity over time.
- **Outcome:** Prototype an evidence-based ecosystem or movement view using
  already-collected public snapshots.
- **Why it matters:** This could differentiate Talon for ecosystem discovery, but
  its value should be proven before adding graph infrastructure.
- **Effort / risk:** Large / high product and data-model uncertainty.
- **Dependencies:** Usage evidence, snapshot semantics, explainable
  visualization, and retention decisions.
- **Acceptance:** A prototype answers one specific operator question faster than
  Projects; every relationship is traceable to stored public evidence; no
  inference is presented as fact.

### 9. Evaluate one selective recruiting integration

- **User problem:** A real team may eventually need to hand candidates to an ATS
  or messaging system, but premature integrations add security and maintenance
  cost.
- **Outcome:** Add only the export or integration proven most valuable by actual
  operator usage, with every external write explicit and reviewable.
- **Why it matters:** Integration can reduce duplicate entry after Talon's core
  workflow is proven; it is not the current differentiator.
- **Effort / risk:** Medium–large / high because credentials and external writes
  expand the trust boundary.
- **Dependencies:** Item 8 evidence, provider selection, least-privilege
  permissions, audit, retries, and deletion behavior.
- **Acceptance:** A documented user need justifies the integration; permissions
  are minimal; retries are idempotent; every external write is visible and
  operator-triggered.

## Explicit product boundaries

- Completed scrape lists remain focused on contributors with public contact
  information. Talon may retain broader scrape facts for totals, deduplication,
  and worker correctness, but it does not present a repository census as a
  sourcing list.
- Billing, public self-service signup, AI candidate scoring, opaque
  recommendations, high-volume parallel scraping, and a built-in pull-request
  viewer are not prioritized. They add cost, risk, or ambiguity without enough
  benefit to the operator-controlled sourcing workflow.
