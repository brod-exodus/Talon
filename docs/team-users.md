# Team User Setup

Talon supports two login paths during the internal team rollout:

- Recruiter team users sign in with Supabase Auth email/password.
- The shared admin password still works as break-glass access when the login email field is left blank.

## Add A Recruiter

1. In Supabase Auth, create a user with email/password.
2. In Supabase SQL Editor, add the same lowercase email to the desired team:

```sql
insert into public.team_memberships (team_id, email, role)
select id, 'recruiter@example.com', 'recruiter'
from public.teams
where slug = 'default'
on conflict (team_id, email) do update
set role = excluded.role;
```

3. Ask the recruiter to sign in with their email and password.

## Roles

- `owner`: team administration.
- `admin`: operational administration.
- `recruiter`: normal recruiting workflows.
- `viewer`: read-only role reserved for a future UI permissions slice.

Current route access is team-scoped by signed session team. Fine-grained UI and API permission checks are the next slice.
