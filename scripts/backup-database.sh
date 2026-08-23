#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

if [[ -z "${TALON_BACKUP_DATABASE_URL:-}" ]]; then
  echo "TALON_BACKUP_DATABASE_URL is required." >&2
  exit 1
fi

if [[ -z "${TALON_BACKUP_OUTPUT_DIR:-}" ]]; then
  echo "TALON_BACKUP_OUTPUT_DIR is required and must be outside the Talon repository." >&2
  exit 1
fi

for dependency in pg_dump pg_restore; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "$dependency is required. Install the PostgreSQL client tools first." >&2
    exit 1
  fi
done

repository_root="$(git rev-parse --show-toplevel)"
mkdir -p "$TALON_BACKUP_OUTPUT_DIR"
output_dir="$(cd "$TALON_BACKUP_OUTPUT_DIR" && pwd -P)"

if [[ "$output_dir" == "/" || "$output_dir/" == "$repository_root/"* ]]; then
  echo "Backup output must be a dedicated directory outside the Talon repository." >&2
  exit 1
fi

chmod 700 "$output_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$output_dir/talon-public-$timestamp.dump"
partial_file="$output_dir/.talon-public-$timestamp.dump.partial"

cleanup() {
  if [[ -f "$partial_file" ]]; then
    rm -f -- "$partial_file"
  fi
}
trap cleanup EXIT INT TERM

export PGDATABASE="$TALON_BACKUP_DATABASE_URL"
pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --schema=public \
  --file="$partial_file"
unset PGDATABASE TALON_BACKUP_DATABASE_URL

pg_restore --list "$partial_file" >/dev/null
mv -- "$partial_file" "$backup_file"
chmod 600 "$backup_file"

if command -v sha256sum >/dev/null 2>&1; then
  checksum="$(sha256sum "$backup_file" | awk '{print $1}')"
else
  checksum="$(shasum -a 256 "$backup_file" | awk '{print $1}')"
fi
printf '%s  %s\n' "$checksum" "$(basename "$backup_file")" > "$backup_file.sha256"
chmod 600 "$backup_file.sha256"

echo "Backup created: $backup_file"
echo "Verification: pnpm backup:verify -- $backup_file"
