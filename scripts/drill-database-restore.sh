#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

backup_file="${1:-}"
target_name="${TALON_RESTORE_TARGET_NAME:-}"
confirmation="${TALON_RESTORE_CONFIRMATION:-}"
target_url="${TALON_RESTORE_DATABASE_URL:-}"
production_host="${TALON_PRODUCTION_DATABASE_HOST:-}"
evidence_dir_input="${TALON_RESTORE_EVIDENCE_DIR:-}"

if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
  echo "Usage: pnpm backup:drill -- /absolute/path/to/talon-public-*.dump" >&2
  exit 1
fi

if [[ ! "$target_name" =~ ^talon-recovery-drill-[a-z0-9][a-z0-9-]{2,62}$ ]]; then
  echo "TALON_RESTORE_TARGET_NAME must start with talon-recovery-drill- and use lowercase letters, numbers, or hyphens." >&2
  exit 1
fi

if [[ "$confirmation" != "RESTORE $target_name" ]]; then
  echo "TALON_RESTORE_CONFIRMATION must exactly equal: RESTORE $target_name" >&2
  exit 1
fi

if [[ -z "$target_url" ]]; then
  echo "TALON_RESTORE_DATABASE_URL is required and must identify the disposable drill database." >&2
  exit 1
fi

if [[ -z "$production_host" ]]; then
  echo "TALON_PRODUCTION_DATABASE_HOST is required so the production hostname can be denied explicitly." >&2
  exit 1
fi

if [[ -z "$evidence_dir_input" ]]; then
  echo "TALON_RESTORE_EVIDENCE_DIR is required and must be outside the Talon repository." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required. Install Node.js first." >&2
  exit 1
fi

target_host="$(TALON_RESTORE_DATABASE_URL="$target_url" node -e '
  try {
    const url = new URL(process.env.TALON_RESTORE_DATABASE_URL)
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") process.exit(2)
    process.stdout.write(url.hostname.toLowerCase())
  } catch { process.exit(2) }
')" || {
  echo "TALON_RESTORE_DATABASE_URL must be a valid PostgreSQL URL." >&2
  exit 1
}

production_host_lower="$(printf '%s' "$production_host" | tr '[:upper:]' '[:lower:]')"
if [[ -z "$target_host" || "$target_host" == "$production_host_lower" ]]; then
  echo "Restore refused: the drill target hostname matches the recorded production hostname." >&2
  exit 1
fi

for dependency in psql pg_restore; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "$dependency is required. Install the PostgreSQL client tools first." >&2
    exit 1
  fi
done

repository_root="$(git rev-parse --show-toplevel)"
mkdir -p "$evidence_dir_input"
evidence_dir="$(cd "$evidence_dir_input" && pwd -P)"
if [[ "$evidence_dir" == "/" || "$evidence_dir/" == "$repository_root/"* ]]; then
  echo "Restore evidence must use a dedicated directory outside the Talon repository." >&2
  exit 1
fi
chmod 700 "$evidence_dir"

backup_file="$(cd "$(dirname "$backup_file")" && pwd -P)/$(basename "$backup_file")"
cd "$repository_root"
"$repository_root/scripts/verify-database-backup.sh" "$backup_file"

preexisting_tables="$(PGDATABASE="$target_url" psql -X -v ON_ERROR_STOP=1 -Atqc "
  SELECT COUNT(*)
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND relation.relname <> 'spatial_ref_sys';
")"
if [[ ! "$preexisting_tables" =~ ^[0-9]+$ || "$preexisting_tables" -ne 0 ]]; then
  echo "Restore refused: the drill target public schema is not empty." >&2
  exit 1
fi

started_epoch="$(date +%s)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
evidence_file="$evidence_dir/talon-restore-drill-${started_epoch}.json"
status="failed"
phase="restore"
schema_version=""
contract_issue_count=""
scrape_count=""
contributor_count=""
project_count=""
membership_count=""
cleanup_status="operator_required"
backup_checksum="$(awk 'NR == 1 {print $1}' "$backup_file.sha256")"
source_commit="$(git rev-parse HEAD)"
expected_schema_version="$(node --experimental-strip-types --input-type=module -e '
  import { EXPECTED_SCHEMA_VERSION } from "./lib/schema-version.ts"
  process.stdout.write(String(EXPECTED_SCHEMA_VERSION))
')"
restore_toc=""
backup_basename="$(basename "$backup_file")"
backup_epoch="$(TALON_BACKUP_BASENAME="$backup_basename" node -e '
  const match = /^talon-public-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump$/.exec(process.env.TALON_BACKUP_BASENAME ?? "")
  if (!match) process.exit(2)
  const [, year, month, day, hour, minute, second] = match
  const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
  if (!Number.isFinite(timestamp)) process.exit(2)
  process.stdout.write(String(Math.floor(timestamp / 1000)))
')" || {
  echo "Backup filename must use the generated talon-public-YYYYMMDDTHHMMSSZ.dump format." >&2
  exit 1
}

write_evidence() {
  local exit_code="$1"
  local finished_epoch finished_at elapsed_seconds backup_age_seconds
  finished_epoch="$(date +%s)"
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  elapsed_seconds="$((finished_epoch - started_epoch))"
  backup_age_seconds="$((started_epoch - backup_epoch))"
  if [[ "$backup_age_seconds" -lt 0 ]]; then backup_age_seconds=0; fi

  TALON_EVIDENCE_FILE="$evidence_file" \
  TALON_EVIDENCE_STATUS="$status" \
  TALON_EVIDENCE_PHASE="$phase" \
  TALON_EVIDENCE_EXIT_CODE="$exit_code" \
  TALON_EVIDENCE_TARGET_NAME="$target_name" \
  TALON_EVIDENCE_SOURCE_COMMIT="$source_commit" \
  TALON_EVIDENCE_BACKUP_FILE="$backup_basename" \
  TALON_EVIDENCE_BACKUP_CHECKSUM="$backup_checksum" \
  TALON_EVIDENCE_STARTED_AT="$started_at" \
  TALON_EVIDENCE_FINISHED_AT="$finished_at" \
  TALON_EVIDENCE_ELAPSED_SECONDS="$elapsed_seconds" \
  TALON_EVIDENCE_BACKUP_AGE_SECONDS="$backup_age_seconds" \
  TALON_EVIDENCE_SCHEMA_VERSION="$schema_version" \
  TALON_EVIDENCE_EXPECTED_SCHEMA_VERSION="$expected_schema_version" \
  TALON_EVIDENCE_CONTRACT_ISSUES="$contract_issue_count" \
  TALON_EVIDENCE_SCRAPES="$scrape_count" \
  TALON_EVIDENCE_CONTRIBUTORS="$contributor_count" \
  TALON_EVIDENCE_PROJECTS="$project_count" \
  TALON_EVIDENCE_MEMBERSHIPS="$membership_count" \
  TALON_EVIDENCE_CLEANUP_STATUS="$cleanup_status" \
  node -e '
    const fs = require("node:fs")
    const numberOrNull = (value) => /^-?\d+$/.test(value ?? "") ? Number(value) : null
    const evidence = {
      version: 1,
      status: process.env.TALON_EVIDENCE_STATUS,
      failedPhase: process.env.TALON_EVIDENCE_STATUS === "failed" ? process.env.TALON_EVIDENCE_PHASE : null,
      exitCode: numberOrNull(process.env.TALON_EVIDENCE_EXIT_CODE),
      targetName: process.env.TALON_EVIDENCE_TARGET_NAME,
      sourceCommit: process.env.TALON_EVIDENCE_SOURCE_COMMIT,
      backup: {
        file: process.env.TALON_EVIDENCE_BACKUP_FILE,
        sha256: process.env.TALON_EVIDENCE_BACKUP_CHECKSUM,
        ageSecondsAtStart: numberOrNull(process.env.TALON_EVIDENCE_BACKUP_AGE_SECONDS),
      },
      startedAt: process.env.TALON_EVIDENCE_STARTED_AT,
      finishedAt: process.env.TALON_EVIDENCE_FINISHED_AT,
      elapsedSeconds: numberOrNull(process.env.TALON_EVIDENCE_ELAPSED_SECONDS),
      validation: {
        schemaVersion: numberOrNull(process.env.TALON_EVIDENCE_SCHEMA_VERSION),
        expectedSchemaVersion: numberOrNull(process.env.TALON_EVIDENCE_EXPECTED_SCHEMA_VERSION),
        schemaContractIssues: numberOrNull(process.env.TALON_EVIDENCE_CONTRACT_ISSUES),
        rowCounts: {
          scrapes: numberOrNull(process.env.TALON_EVIDENCE_SCRAPES),
          contributors: numberOrNull(process.env.TALON_EVIDENCE_CONTRIBUTORS),
          projects: numberOrNull(process.env.TALON_EVIDENCE_PROJECTS),
          memberships: numberOrNull(process.env.TALON_EVIDENCE_MEMBERSHIPS),
        },
      },
      cleanupStatus: process.env.TALON_EVIDENCE_CLEANUP_STATUS,
    }
    fs.writeFileSync(process.env.TALON_EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  '
  echo "Restore drill evidence: $evidence_file"
}

on_exit() {
  local exit_code="$?"
  trap - EXIT
  if [[ -n "$restore_toc" && -f "$restore_toc" ]]; then
    rm -f -- "$restore_toc"
  fi
  write_evidence "$exit_code"
  exit "$exit_code"
}
trap on_exit EXIT

# Generate SQL from the verified archive and apply it as one transaction. The
# target URL remains in the environment rather than the process argument list.
# A fresh Supabase target already owns the public schema, so omit only the
# archive entries that would recreate or rewrite that schema itself.
restore_toc="$(mktemp "${TMPDIR:-/tmp}/talon-restore-toc.XXXXXX")"
pg_restore --list "$backup_file" |
  awk '!/ SCHEMA - public / && !/ ACL - SCHEMA public / && !/ COMMENT - SCHEMA public /' > "$restore_toc"
pg_restore --no-owner --no-acl --use-list="$restore_toc" --file=- "$backup_file" |
  PGDATABASE="$target_url" psql -X -v ON_ERROR_STOP=1 --single-transaction --quiet

phase="schema_validation"
schema_version="$(PGDATABASE="$target_url" psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT public.get_talon_schema_version();")"
contract_issue_count="$(PGDATABASE="$target_url" psql -X -v ON_ERROR_STOP=1 -Atqc "
  SELECT COUNT(*)
  FROM (
    SELECT requirement_type, requirement_name FROM public.get_talon_schema_contract_issues()
    UNION ALL
    SELECT requirement_type, requirement_name FROM public.get_talon_append_only_contract_issues()
    UNION ALL
    SELECT requirement_type, requirement_name FROM public.get_talon_session_contract_issues()
    UNION ALL
    SELECT requirement_type, requirement_name FROM public.get_talon_session_limit_contract_issues()
    UNION ALL
    SELECT requirement_type, requirement_name FROM public.get_talon_scheduling_contract_issues()
  ) AS contract_issues;
")"

if [[ ! "$schema_version" =~ ^[0-9]+$ || "$schema_version" -ne "$expected_schema_version" ]]; then
  echo "Restore validation failed: schema version does not match this Talon commit." >&2
  exit 1
fi
if [[ ! "$contract_issue_count" =~ ^[0-9]+$ || "$contract_issue_count" -ne 0 ]]; then
  echo "Restore validation failed: the physical schema contract is incomplete." >&2
  exit 1
fi

phase="row_count_validation"
read -r scrape_count contributor_count project_count membership_count < <(
  PGDATABASE="$target_url" psql -X -v ON_ERROR_STOP=1 -AtF ' ' -c "
    SELECT
      (SELECT COUNT(*) FROM public.scrapes),
      (SELECT COUNT(*) FROM public.contributors),
      (SELECT COUNT(*) FROM public.ecosystems),
      (SELECT COUNT(*) FROM public.team_memberships);
  "
)

for count in "$scrape_count" "$contributor_count" "$project_count" "$membership_count"; do
  if [[ ! "$count" =~ ^[0-9]+$ ]]; then
    echo "Restore validation failed: a required row count is unavailable." >&2
    exit 1
  fi
done

status="succeeded"
phase="complete"
echo "Restore drill succeeded for $target_name in $(( $(date +%s) - started_epoch )) seconds."
echo "Delete the disposable target after application checks, then record cleanup beside the evidence file."
