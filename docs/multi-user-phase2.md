# Talon Phase 2: Multi-User Team Rollout

This document defines the migration path from single-admin Talon to team-based Talon for recruiting teams.

## Goal

Enable multiple recruiters to use Talon within shared team workspaces, with role-based access and team-scoped data.

## Current State

- Single shared admin password/session model.
- No per-user identity.
- No team ownership boundary in application logic.

## Implemented Foundation

Migration:

- `db/migrations/008_team_foundation.sql`

Adds:

- `teams`
- `team_memberships`
- `team_id` ownership columns on core entities
- Backfill to a seeded `default` team
- Team-focused indexes

This is backward-compatible with current behavior until app-level team scoping is turned on.

## Next Slices

1. Identity and Session Upgrade
2. Team Context Resolution
3. Team-Scoped Data Access
4. Roles and Permissions
5. Invite Flow for Recruiters

## Slice 1: Identity and Session Upgrade

Target:

- Move from shared admin password to per-user sign-in.
- Recommended: Supabase Auth (email magic link or password).

Requirements:

- Add `users` table or map to Supabase auth users.
- Persist user id + active team id in server session/cookie.
- Keep admin emergency access only for break-glass use.

## Slice 2: Team Context Resolution

Target:

- Resolve active team from session on every authenticated request.

Requirements:

- Add helper: `getActiveTeamId(request)`.
- Reject requests when no active team exists.
- Include team id in audit metadata.

## Slice 3: Team-Scoped Data Access

Target:

- Every read/write to business data scoped by `team_id`.

Requirements:

- Add `.eq("team_id", activeTeamId)` to all relevant queries.
- Ensure inserts include `team_id`.
- Update worker claim logic to claim queued jobs per team or globally with team-safe updates.

## Slice 4: Roles and Permissions

Roles:

- `owner`
- `admin`
- `recruiter`
- `viewer`

Rules:

- `viewer`: read-only
- `recruiter`: scrape, watch, outreach edits
- `admin`: plus settings and share controls
- `owner`: plus team membership management

## Slice 5: Invite Flow

Target:

- Team owners/admins can invite teammates by email.

Requirements:

- Create invite records.
- Email-based onboarding.
- Join on acceptance into `team_memberships`.

## Public App Future (Post-Team)

For “anyone can use it” mode:

- Self-serve team creation.
- Billing/subscription and usage limits per team.
- Automated abuse controls and stronger throttling.
- Tenant-aware analytics and support tooling.

## Rollout Notes

- Apply migration `008` before app-level team scoping.
- Keep `default` team in place until all legacy data is migrated and users are assigned real teams.
- Ship slices incrementally behind feature flags where practical.
