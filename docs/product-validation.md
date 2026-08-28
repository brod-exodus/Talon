# Talon sourcing validation protocol

Use this protocol to learn whether Talon helps a recruiter reach contactable
GitHub candidates faster. It is a lightweight product study, not employee
monitoring and not a request to collect more candidate data.

## Safety rules

- Use public GitHub repositories only.
- Do not record contributor names, usernames, contact details, profile URLs,
  recruiter notes, private repository names, credentials, or screenshots of
  candidate results.
- Record task-level counts, time, help required, and participant feedback only.
- Do not enable analytics, session recording, or a third-party research tool for
  this study.
- Delete test scrapes, shares, exports, and notes that are not needed afterward.

## Participants and completion rule

Run three sessions: the primary operator and at least two other people who can
reason about technical recruiting or candidate sourcing. A session counts only
when the participant drives the product while the observer avoids coaching.

Use a different public repository or organization in each session. Do not tune
the target after seeing its results merely to make Talon look successful.

## Tasks

Give the participant this outcome without describing the controls:

> Use Talon to find contactable contributors from this public GitHub target,
> identify whether anyone matches a location you care about, preserve one useful
> candidate for follow-up, and create either a CSV or a safe read-only share for
> the next person in the recruiting process.

Observe these checkpoints:

1. Start the repository or organization scrape.
2. Recognize queued, running, completed, or failed state without help.
3. Open the contact-focused completed list.
4. Search a location and inspect at least one useful profile when available.
5. Preserve one candidate in an existing Project/list or Pipeline workflow.
6. Export CSV or create and revoke a read-only share.

If the chosen public target contains no contactable or location-matching result,
record that as a valid product outcome. Do not substitute a known-good target
mid-session.

## Evidence record

Create one private note per session outside the repository. Record only:

```text
Session date:
Participant type: operator / recruiter / technical evaluator
Target type: repository / organization
Task completed: yes / partly / no
Time to scrape accepted:
Time to completed contactable list:
Time to preserved candidate or confirmed no useful result:
Help required: none / one prompt / multiple prompts
Export or safe share completed: yes / no / not applicable
Result usefulness: 1–5
Confidence using Talon again: 1–5
Largest friction point, in the participant's words:
Observer note (one sentence, no personal data):
```

Approximate timing is sufficient. The purpose is to compare task outcomes, not
to measure a participant's speed.

## Synthesis and decision

After three sessions, write a short aggregate summary containing:

- completion count and median time to a completed contactable list;
- median usefulness and confidence scores;
- number of sessions requiring help;
- friction reported in at least two sessions;
- errors or reliability failures, separated from usability confusion;
- one recommendation: keep the workflow unchanged, fix one validated
  bottleneck, or run more research because evidence conflicts.

Promote a product change only when a problem repeats, blocks completion, creates
a security or accessibility risk, or materially increases time to a sourcing
outcome. Treat one person's feature suggestion as a hypothesis, not a roadmap
commitment. If the workflow performs well, record that decision and stop.

## Recheck after a change

For an approved change, repeat the affected task with the same starting
conditions and compare the named baseline. Keep the PR small, preserve Talon's
contact-focused result policy, and do not claim improvement without the repeated
observation.
