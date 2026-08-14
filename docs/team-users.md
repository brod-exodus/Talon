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

## Roles

- `owner`: team administration.
- `admin`: operational administration.
- `recruiter`: normal recruiting workflows.
- `viewer`: read-only role reserved for a future UI permissions slice.

Current route access is team-scoped by signed session team. Fine-grained UI and API permission checks are the next slice.
