# Team User Setup

Talon supports two login paths during the internal team rollout:

- Recruiter team users sign in with Supabase Auth email/password.
- The shared admin password still works as break-glass access when the login email field is left blank.

Public workspace creation is closed by default. Existing users continue to sign
in normally, and administrators provision new accounts from **Settings → Team
Access**. Do not enable self-service signup merely to add a teammate.

## Add A Recruiter

The preferred operator workflow is **Settings → Team Access**. Enter the
recruiter's email, display name, role, and a temporary password. Talon creates
the Supabase Auth user and workspace membership through the protected admin
route.

For break-glass recovery, an operator can still create the user in Supabase Auth
and add the same lowercase email to the desired team in SQL Editor:

```sql
insert into public.team_memberships (team_id, email, role)
select id, 'recruiter@example.com', 'recruiter'
from public.teams
where slug = 'default'
on conflict (team_id, email) do update
set role = excluded.role;
```

Ask the recruiter to sign in with their email and temporary password, then have
them change it from Settings.

## Password Recovery

Talon provides a non-enumerating **Forgot password?** flow for existing team
users. It is hidden and disabled unless `TALON_PASSWORD_RECOVERY_ENABLED=true`.
Leave this setting absent or `false` until delivery is ready. Production
activation requires Supabase Auth email delivery and a custom
Recovery email template. In **Authentication → Email Templates → Reset
Password**, use a link with this exact shape:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">
  Reset your Talon password
</a>
```

In **Authentication → URL Configuration**, set the production Site URL and add
`https://github-scraper-v2.vercel.app/reset-password` to the redirect allowlist.
Configure a custom SMTP sender before relying on recovery for real users; the
Supabase trial sender is rate-limited and best-effort. Disable provider link
tracking because rewritten authentication links can fail.

After changing the template, request a reset for a test team user, open the
email, set a new password, confirm the old password no longer works, and confirm
every previously active Talon session requires login again. Never paste a reset
link into logs, tickets, SQL Editor, or a pull request.

Only after that test succeeds, set `TALON_PASSWORD_RECOVERY_ENABLED=true` for
Production in Vercel and redeploy. To disable recovery later, set it back to
`false`; existing login and administrator-managed password changes are
unaffected.

## Roles

- `owner`: full access, including teammate accounts, roles, and ownership.
- `admin`: operational administration, without teammate or ownership changes.
- `recruiter`: normal recruiting workflows.
- `viewer`: read-only access.

Every route rechecks the current database membership. A downgrade or removal
therefore takes effect on the next request without waiting for the signed session
to expire. Existing database roles also take precedence over older Supabase Auth
metadata during later logins, so a changed role cannot revert at sign-in. The
break-glass admin login retains teammate recovery access.

Migration `040_atomic_team_member_management.sql` serializes role changes and
removals for each team. The database rejects demoting or removing the final
application owner, including when two requests arrive concurrently. Promote a
second owner before transferring or removing the current owner.
