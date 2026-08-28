# Talon product and engineering roadmap

Updated: August 2026

Talon's primary job is to turn public GitHub contribution activity into a fast,
focused list of candidates a recruiter can actually contact. Completed scrape
results remain contact-focused: repository totals provide context, while the
actionable list contains people with public contact details.

The core product and reliability architecture are mature enough for real-world
validation. The next decision should come from observed recruiting outcomes,
not from adding more infrastructure or speculative features. Ranking considers
user value, risk reduction, effort, and strategic importance. Effort is a rough
estimate for one experienced operator or engineer.

## Now

### 1. Validate the sourcing outcome with real operators

- **User problem:** Talon is technically reliable, but repository tests cannot
  prove that a recruiter finds useful, contactable candidates faster.
- **Proposed outcome:** Run three structured sourcing sessions using the existing
  product and record aggregate task evidence with no candidate identity,
  contact data, recruiter notes, credentials, or private repository details.
- **Why it matters:** This distinguishes a real product bottleneck from a feature
  idea and gives a portfolio reviewer user-outcome evidence, not only engineering
  claims.
- **Effort / risk:** Small (three sessions plus synthesis) / low. The main risk is
  leading participants or retaining personal data; the protocol prevents both.
- **Dependencies:** A healthy deployed Talon instance, public GitHub targets,
  one operator and at least two evaluators, and `docs/product-validation.md`.
- **Acceptance criteria:** Three sessions are completed; each records task
  completion, elapsed time, help required, result usefulness, and the largest
  friction point; no prohibited personal data is retained; findings identify
  one repeated bottleneck or explicitly support keeping the workflow unchanged.

### 2. Establish actual recovery evidence

- **User problem:** Talon has safe backup, verification, restore-drill, and
  readiness commands, but tooling alone does not protect Production data.
- **Proposed outcome:** Create encrypted logical backups when Talon is active,
  confirm the newest backup remains inside the 24-hour target, and complete one
  isolated restore drill with cleanup recorded.
- **Why it matters:** A portfolio-quality recovery claim must be supported by a
  real archive and restore result rather than an unexecuted runbook.
- **Effort / risk:** Medium operator setup / medium. Database credentials and
  restored recruiting data require careful handling; existing scripts fail
  closed around Production targets and repository storage.
- **Dependencies:** PostgreSQL client tools, encrypted storage outside the
  repository, Production database access, and a disposable Supabase project.
- **Acceptance criteria:** `pnpm backup:status` reports a verified backup within
  24 hours; one successful drill is within 92 days and the 4-hour RTO; the
  disposable target is deleted and cleanup is recorded; no archive, evidence,
  URL, or credential enters Git, email, or a pull request.

### 3. Resolve only the first validated sourcing bottleneck

- **User problem:** Unprioritized interface changes have previously added
  clutter without improving candidate sourcing.
- **Proposed outcome:** After item 1, ship the smallest independently measurable
  correction for the highest-frequency or highest-severity observed problem—or
  make no product change if the workflow performs well.
- **Why it matters:** This preserves Talon's focused workflow and spends
  engineering effort where a recruiter can feel the result.
- **Effort / risk:** Unknown until evidence exists; cap the first change at one
  reviewable PR. Product risk is low only if the evidence gate is respected.
- **Dependencies:** Item 1 synthesis, current accessibility and browser gates,
  and a baseline metric that can be repeated after the change.
- **Acceptance criteria:** The PR names the observed problem and baseline,
  defines a non-goal, adds proportional tests, and improves the chosen task
  measure without degrading scrape reliability, workspace isolation, secret
  handling, mobile use, or contact-focused results.

## Next

### 4. Activate password recovery when email is deliverable

- **User problem:** A user who forgets a password still needs owner help while
  Production email delivery is unavailable.
- **Proposed outcome:** Activate Talon's delivered non-enumerating, time-limited
  reset flow after a sender domain and Supabase SMTP delivery are proven.
- **Why it matters:** Secure self-recovery reduces temporary-password handling,
  but advertising a reset email that cannot arrive is worse than keeping the
  feature disabled.
- **Effort / risk:** Small application work plus operator configuration / medium
  email and account-security risk.
- **Dependencies:** An owned sender domain, authenticated SMTP provider,
  Supabase recovery template, redirect allowlist, and delivery logs.
- **Acceptance criteria:** Known and unknown accounts receive the same request
  response; a real email arrives; the token works once and expires; existing
  Talon sessions are revoked after reset; the delivery test passes before
  `TALON_PASSWORD_RECOVERY_ENABLED` is enabled.
- **Status:** Blocked by sender-domain availability; do not add a workaround that
  weakens deliverability or account security.

### 5. Replace temporary-password onboarding with invitations

- **User problem:** Owners can provision teammates, but temporary passwords are
  less safe and less auditable than a bounded invitation lifecycle.
- **Proposed outcome:** Add expiring, single-use, owner-issued invitations fixed
  to one workspace and role.
- **Why it matters:** This is the remaining workflow needed for a small real
  recruiting team, but it should reuse proven email delivery rather than create
  a second incomplete email path.
- **Effort / risk:** Medium–large (about one week) / medium–high.
- **Dependencies:** Item 4, invitation state, owner-only authorization, delivery
  monitoring, and revocation behavior.
- **Acceptance criteria:** Invitations expire, are single-use and
  workspace-bound; revoked invitations fail closed; acceptance creates exactly
  one membership with the owner-selected role; logs contain no raw token or
  email address.

### 6. Decide whether aggregate product telemetry is justified

- **User problem:** Manual validation is appropriate now, but it will not scale
  if several people use Talon repeatedly.
- **Proposed outcome:** After validation, decide whether opt-in aggregate
  workflow metrics would materially improve product decisions.
- **Why it matters:** Instrumentation has privacy and maintenance cost. Talon
  should add it only when manual evidence is no longer sufficient.
- **Effort / risk:** Decision: small. Implementation: medium / medium privacy
  risk.
- **Dependencies:** Item 1 findings, explicit operator consent, stable metric
  definitions, and a retention decision.
- **Acceptance criteria:** A written decision rejects telemetry with a reason or
  defines a minimal event set containing no repository target, contributor
  identity, notes, contact data, or secret; collection can be disabled and
  aggregate counts reconcile.

## Later

### 7. Explore ecosystem relationships and contributor movement

- **User problem:** Projects aggregate contributors but do not show durable
  repository relationships or changes in public contribution activity.
- **Proposed outcome:** Prototype one evidence-based ecosystem question using
  already-collected public snapshots before adding graph infrastructure.
- **Why it matters:** This could differentiate Talon for ecosystem discovery,
  but its recruiting value remains unproven.
- **Effort / risk:** Large / high product and data-model uncertainty.
- **Dependencies:** Repeated validation demand, explainable snapshot semantics,
  retention decisions, and a prototype outside the production workflow.
- **Acceptance criteria:** The prototype answers one repeated operator question
  faster than Projects; every relationship is traceable to stored public
  evidence; no inference is presented as fact; production implementation still
  requires a separate decision.

### 8. Evaluate one selective recruiting integration

- **User problem:** A real team may eventually need to move candidates into an
  ATS or messaging system, but premature integrations expand Talon's trust and
  maintenance boundaries.
- **Proposed outcome:** Add only the export or integration repeatedly requested
  during real use, with every external write explicit and reviewable.
- **Why it matters:** Integration can reduce duplicate entry after Talon's core
  workflow is proven; it is not the current differentiator.
- **Effort / risk:** Medium–large / high because credentials and external writes
  expand the security boundary.
- **Dependencies:** Validated demand, provider selection, least-privilege
  permissions, audit, retry, and deletion behavior.
- **Acceptance criteria:** At least two operators demonstrate the same need;
  permissions are minimal; retries are idempotent; every external write is
  visible and operator-triggered; removal and credential rotation are tested.

## Delivered engineering foundation

The repository already demonstrates durable bounded scraping, resumable and
idempotent checkpoints, fair workspace scheduling, shared GitHub cooldown,
request-weighted worker budgets, failure diagnostics and timelines, persistent
health evidence, SLO monitoring, production smoke coverage, mobile and
accessibility browser gates, workspace referential integrity, append-only audit
history, session controls, privacy-aware export and deletion, durable external
cleanup, migration release gating, dependency security, capacity and
concurrency benchmarks, fault-injection integration tests, verified backups,
and isolated restore drills. Detailed behavior and rollback guidance remain in
`docs/ops.md`, `docs/disaster-recovery.md`, and the relevant tests.

## Explicit product boundaries

- Do not add dashboard explanation, duplicate controls, or workflow rearrangement
  without a demonstrated defect or repeated user need.
- Completed scrape lists remain focused on contributors with public contact
  information; Talon is a sourcing tool, not a repository census.
- Preserve the durable worker, workspace isolation, server-side credentials,
  fail-closed authorization, and operator-controlled deployment model.
- Billing, public self-service signup, AI scoring, opaque recommendations,
  high-volume parallel scraping, and a built-in pull-request viewer are not
  prioritized.
- A healthy validation result is permission to stop changing the workflow, not
  a reason to manufacture a new feature.
