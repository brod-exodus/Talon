# Dependency and CI Security

Talon treats the lockfile and its delivery automation as production code.

## Automated controls

- CI rejects known high- or critical-severity advisories across production and
  development dependencies with `pnpm security:audit`.
- GitHub Dependency Review blocks pull requests that introduce a high-severity
  dependency advisory.
- CodeQL scans JavaScript and TypeScript on pull requests, default-branch pushes,
  and a weekly schedule.
- Dependabot groups compatible minor and patch updates weekly and keeps GitHub
  Actions current.
- Every third-party Action is pinned to a full commit SHA. Dependabot can update
  the pin; reviewers should confirm that the SHA belongs to the documented major
  release before merging.

## Current remediation

The delivery-security baseline upgrades Next.js and its matching ESLint config
from 15.5.9 to 15.5.23, updates PostCSS, and removes the unused `geist` and
`@vercel/analytics` packages. Targeted pnpm overrides hold transitive packages
at versions containing upstream security fixes where their direct parent has
not yet refreshed its range.

Overrides are temporary compatibility tools, not permanent ownership of a fork.
On each Dependabot update:

1. Run `pnpm why <package>` for each overridden package.
2. Remove an override when all parent dependency ranges resolve to a patched
   release on their own.
3. Run `pnpm security:audit`, `pnpm verify`, and `pnpm build`.
4. Do not suppress an advisory merely to make CI green. Document an explicit,
   time-bounded exception if no safe upgrade exists.

## Incident response

For a newly disclosed high-severity issue, identify whether Talon invokes the
affected path, but patch the dependency even when exploitability is uncertain if
a compatible fix exists. Rotate secrets immediately if the issue could expose
credentials, then run the production smoke workflow after deployment.
