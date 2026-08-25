# Recruiter workflow and state ownership

Talon's primary workflow is:

1. **Discover:** run a repository or organization scrape and review public contribution evidence.
2. **Organize:** add promising contributors to a Project or recruiting list for a specific role or search.
3. **Outreach:** manage that Project's outreach status, contact dates, notes, and follow-ups in the Project or Pipeline.

This model keeps public discovery evidence separate from recruiter decisions and prevents one role's outreach state from silently changing another role.

## State ownership

| Field or action | Owner | Where it appears | Meaning |
| --- | --- | --- | --- |
| Public profile and contact fields | Contributor | Scrape results, contributor profile, Projects, previews, public shares | Reusable public evidence refreshed from GitHub or manually curated where supported. |
| Contributor notes | Contributor | Scrape results and contributor profile | Private general context that follows the person across every scrape and Project. |
| General contacted flag and date | Contributor | Completed scrape results | A backward-compatible general contact record. New role-specific work should use Project outreach. |
| Contributor reminder | Contributor | Contributor profile | A general reminder about the person. It is not shown as a Project Pipeline follow-up. |
| Project membership | Project | Dashboard, Projects | Groups scrapes and their contactable contributors for one role, search, or market map. |
| List membership | Project list | Project | A shortlist or other recruiter-defined grouping inside one Project. |
| Outreach status | Project + contributor | Project, quick preview, Pipeline, Follow-ups | The person's stage for one Project only. |
| Project outreach notes | Project + contributor | Project, quick preview, Pipeline, Follow-ups | Private context for that Project's outreach. |
| Project last-contacted date | Project + contributor | Project, quick preview, Pipeline | Contact timing for that Project. |
| Project next-follow-up date | Project + contributor | Project, quick preview, Pipeline, Follow-ups | Drives the Project-specific follow-up queue. |
| Source history and contribution counts | Scrape result | Dashboard, contributor profile, Project | Public evidence from the repository or organization scrape; recruiter edits do not change it. |

## Product language

- Use **Contributor notes** and **Contributor reminder** for person-wide state.
- Use **Project outreach status**, **Project outreach notes**, **Project last contacted**, and **Project next follow-up** for role-specific state.
- Use **Project** for the role or search container and **list** for a shortlist within it.
- Use **Pipeline** for active Project outreach and due follow-ups.

Existing contributor-wide records remain supported for compatibility. Talon should guide new outreach work toward Projects rather than copying or migrating those records automatically, because the correct Project cannot be inferred safely.
