# Talon product and engineering roadmap

Updated: August 2026

Talon's primary job is to turn public GitHub contribution activity into a fast,
focused list of candidates a recruiter can actually contact. Completed scrape
results therefore remain contact-focused: repository contributor totals provide
context, while the actionable list contains people with public contact details.

Talon already has a strong engineering foundation: durable bounded workers,
workspace isolation, server-managed secrets, resumable GitHub work, safe
sharing, recovery runbooks, production health evidence, and broad invariant
tests. The recruiter workflow is intentionally stable for now. This roadmap
prioritizes reliability, recoverability, operational evidence, security, and
capacity confidence over additional interface changes or speculative features.

Ranking considers user value, risk reduction, effort, and strategic importance.
Effort is a rough estimate for one experienced engineer.

## Now

### 1. Prove worker concurrency and recovery contracts — completed

- **User problem:** Talon's capacity benchmark modeled one scrape at a time and
  could not detect regressions involving competing workers, workspace fairness,
  stale leases, or the shared GitHub cooldown.
- **Outcome:** Add a deterministic concurrency harness and retain its JSON result
  as a short-lived CI artifact.
- **Why it matters:** The durable queue's value depends on correct behavior when
  invocations overlap or stop unexpectedly, not only on single-job speed.
- **Effort / risk:** Small (1–2 days) / low; test infrastructure only.
- **Dependencies:** Existing claim fairness, stale recovery, lease validation,
  and GitHub cooldown contracts.
- **Acceptance:** Competing workers cannot duplicate a claim; work rotates across
  workspaces; aged background work progresses; a stale worker cannot complete
  after handoff; cooldown blocks claims without spending attempts; CI fails on a
  regression.
- **Delivered:** The deterministic worker-concurrency benchmark covers these
  boundaries without production traffic or schema changes.

### 2. Produce repeatable isolated restore-drill evidence — completed

- **User problem:** Talon can create and validate logical backups, but a valid
  archive alone does not prove that a clean environment can restore it within
  the documented recovery target.
- **Outcome:** Add an operator-triggered isolated restore drill that records
  elapsed time, integrity checks, backup age, and cleanup status.
- **Why it matters:** Recoverability should be demonstrated, not inferred from a
  backup file.
- **Effort / risk:** Medium (3–5 days) / medium because database restores are
  destructive if their target is not strictly isolated.
- **Dependencies:** Existing backup scripts and runbook, an explicitly supplied
  non-production target, and fail-closed target validation.
- **Acceptance:** The command refuses production-like or ambiguous targets;
  restores a verified backup into an empty isolated database; runs schema and
  integrity checks; records elapsed restore time and backup age for RTO/RPO
  review; and records cleanup responsibility without silently deleting the
  drill environment.
- **Delivered:** The operator-triggered restore command enforces an empty,
  explicitly named non-production target, validates the restored physical schema
  and aggregate row counts, and writes a secret-free evidence record on success
  or post-restore failure. A read-only readiness command now verifies the newest
  backup checksum and reports whether backup and drill evidence remain inside
  the documented 24-hour and quarterly targets.

### 3. Add worker fault-injection integration coverage — completed

- **User problem:** Invariant and deterministic tests cover individual queue
  boundaries, but no isolated integration scenario interrupts work immediately
  before and after checkpoints, completion, and cooldown activation.
- **Outcome:** Exercise the real database transitions with controlled worker and
  GitHub adapters in a disposable environment.
- **Why it matters:** This is the strongest remaining test for lost work, duplicate
  work, and stale-worker overwrites across process interruptions.
- **Effort / risk:** Medium–large (1 week) / medium.
- **Dependencies:** Item 1, the fresh-Supabase CI job, deterministic provider
  responses, and fixture cleanup.
- **Acceptance:** Every interruption point resumes idempotently; terminal counts
  reconcile; cancellation and newer leases win; cooldown is global; no fixture
  crosses workspace scope; CI produces a concise failure trace.
- **Delivered:** The disposable Supabase CI database now exercises checkpoint
  recovery after stale-lease handoff, committed hydration replay, verified
  completion, cancellation precedence, global cooldown behavior, and
  workspace-scoped claims through the real database functions. Fixtures run in
  a rolled-back transaction, and CI retains a short trace for seven days.

## Next

### Accessible critical-path browser gate — completed

- **User problem:** Talon's browser tests proved scrape recovery behavior, but
  did not detect serious accessibility regressions or page-wide horizontal
  overflow on a phone-sized screen.
- **Outcome:** Test the login and primary dashboard at desktop and mobile sizes
  with an automated accessibility engine and responsive-layout assertion.
- **Why it matters:** Recruiters should be able to use Talon's core workflow
  with assistive technology and smaller screens, and portfolio claims should be
  supported by repeatable evidence.
- **Effort / risk:** Small / low; test and documentation changes only.
- **Dependencies:** Existing deterministic Playwright fixtures and Chromium CI.
- **Acceptance:** CI fails for serious or critical automated accessibility
  violations or page-wide horizontal overflow on login or the dashboard at
  desktop and 390-pixel mobile widths; failures retain the existing browser
  trace, screenshot, video, and report artifacts.
- **Delivered:** The browser suite now runs this gate without Production data,
  credentials, or mutations. Automated scanning supplements rather than
  replaces keyboard and screen-reader review. The gate also covers an expanded
  contactable candidate result and a populated Pipeline at both viewport sizes.

### Release sequencing guard — completed

- **User problem:** A migration PR could be merged even when its checklist still
  said the Production migration had not been applied, briefly deploying an
  application ahead of its database.
- **Outcome:** Make the existing required Verify check block migration PRs until
  the operator confirms application and lists every new migration file.
- **Why it matters:** This prevents a repeated, avoidable deployment mismatch
  without granting GitHub or CI access to the Production database.
- **Effort / risk:** Small / low; release-process enforcement only.
- **Dependencies:** Expand-first migrations, the existing PR template, and the
  required Verify check.
- **Acceptance:** Migration-free PRs pass automatically; a migration PR fails
  while unchecked or incompletely listed; editing the PR reruns CI; exact
  migration paths and a checked acknowledgement pass; no Production secret is
  read or stored.

### 4. Add safe self-service password recovery

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
- **Application flow delivered:** Talon now provides the non-enumerating request,
  one-time server-side token verification, password update, and fail-closed
  Talon-session revocation flow. Production activation remains dependent on the
  documented Supabase recovery template, redirect allowlist, SMTP sender, and a
  real delivery test.
- **Safe activation delivered:** The login action and public request endpoint
  remain off unless `TALON_PASSWORD_RECOVERY_ENABLED=true`, so an unconfigured
  deployment never advertises a reset email that cannot arrive.

### 5. Add privacy-aware data lifecycle controls

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
- **Foundation delivered:** A CI-enforced lifecycle contract now classifies every
  Postgres table, documents existing retention and cascade behavior, identifies
  Auth, Storage, backup, export, and audit boundaries, and defines the safety
  requirements for the transactional deletion design.
- **Preview delivered:** Owners now have a count-only, non-cached lifecycle
  diagnostic backed by one team-scoped database function. It reports live
  Postgres scope, active-work blockers, and external systems that remain
  uncounted without exposing row content or enabling deletion.
- **Portable export delivered:** Owners can download a versioned JSON copy of
  recruiter-owned workspace data through a non-cached, audited endpoint. The
  export uses an explicit field allowlist, omits operational and secret-bearing
  systems, and fails rather than returning a partial file when the immediate
  download limit is exceeded.
- **Offline verification delivered:** A local command validates the export
  format, size, entity uniqueness, and cross-record references without printing
  contacts or recruiter notes. This makes a downloaded archive testable instead
  of merely assuming that valid JSON is complete.
- **Guarded deletion delivered:** Signed-in owners can preview, export, and
  permanently delete a workspace from Settings. Exact slug confirmation,
  active-work blockers, a locked database transaction, an anonymous receipt,
  session removal, and separately reported Storage cleanup preserve the
  workspace and privacy boundaries. Supabase Auth accounts and backups remain
  intentionally outside the deletion boundary.
- **External cleanup recovery delivered:** Profile-photo deletion now uses a
  private durable task created in the same transaction as workspace deletion.
  The one-minute worker retries failures with leases and bounded backoff, while
  terminal failures remain operationally visible.
- **Operator recovery delivered:** If automatic profile-photo cleanup exhausts
  its retry budget, Production Readiness offers an admin-only recovery action.
  It requeues only terminal cleanup work, records the operation, and leaves the
  one-minute worker responsible for durable execution.
- **Cleanup data minimization delivered:** Successful profile-photo cleanup now
  erases its object paths in the lease-validated completion transaction. Existing
  completed rows are scrubbed during migration, while retryable work retains the
  paths it still needs.
- **Cleanup retention delivered:** Daily keepalive now removes successful,
  path-free cleanup evidence after 90 days while retaining every queued,
  running, or failed task until its external deletion is actually resolved.

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
- **Dependencies:** Item 7 evidence, provider selection, least-privilege
  permissions, audit, retries, and deletion behavior.
- **Acceptance:** A documented user need justifies the integration; permissions
  are minimal; retries are idempotent; every external write is visible and
  operator-triggered.

## Explicit product boundaries

- The current recruiter workflow is stable. Roadmap work should not add
  explanatory dashboard UI or rearrange existing sourcing actions unless a
  demonstrated defect or measurable user need justifies the change.
- Completed scrape lists remain focused on contributors with public contact
  information. Talon may retain broader scrape facts for totals, deduplication,
  and worker correctness, but it does not present a repository census as a
  sourcing list.
- Billing, public self-service signup, AI candidate scoring, opaque
  recommendations, high-volume parallel scraping, and a built-in pull-request
  viewer are not prioritized. They add cost, risk, or ambiguity without enough
  benefit to the operator-controlled sourcing workflow.
