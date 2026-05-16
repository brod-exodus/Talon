-- Team-aware uniqueness for Phase 2 multi-user support.
-- Run after db/migrations/008_team_foundation.sql.

ALTER TABLE contributors
  DROP CONSTRAINT IF EXISTS contributors_github_username_key;

ALTER TABLE contributors
  DROP CONSTRAINT IF EXISTS contributors_team_github_username_key;

ALTER TABLE contributors
  ADD CONSTRAINT contributors_team_github_username_key UNIQUE (team_id, github_username);

ALTER TABLE ecosystems
  DROP CONSTRAINT IF EXISTS ecosystems_name_key;

ALTER TABLE ecosystems
  DROP CONSTRAINT IF EXISTS ecosystems_team_name_key;

ALTER TABLE ecosystems
  ADD CONSTRAINT ecosystems_team_name_key UNIQUE (team_id, name);

ALTER TABLE watched_repos
  DROP CONSTRAINT IF EXISTS watched_repos_repo_key;

ALTER TABLE watched_repos
  DROP CONSTRAINT IF EXISTS watched_repos_team_repo_key;

ALTER TABLE watched_repos
  ADD CONSTRAINT watched_repos_team_repo_key UNIQUE (team_id, repo);
