#!/usr/bin/env bash
set -euo pipefail
set +x

backup_file="${1:-}"
if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
  echo "Usage: pnpm backup:verify -- /absolute/path/to/talon-public-*.dump" >&2
  exit 1
fi

checksum_file="$backup_file.sha256"
if [[ ! -f "$checksum_file" ]]; then
  echo "Checksum file is missing: $checksum_file" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required. Install the PostgreSQL client tools first." >&2
  exit 1
fi

expected="$(awk 'NR == 1 {print $1}' "$checksum_file")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$backup_file" | awk '{print $1}')"
else
  actual="$(shasum -a 256 "$backup_file" | awk '{print $1}')"
fi

if [[ -z "$expected" || "$actual" != "$expected" ]]; then
  echo "Backup checksum verification failed." >&2
  exit 1
fi

entry_count="$(pg_restore --list "$backup_file" | awk '!/^;/ && NF {count += 1} END {print count + 0}')"
if [[ "$entry_count" -lt 1 ]]; then
  echo "Backup contains no restorable entries." >&2
  exit 1
fi

echo "Backup verified: checksum valid, $entry_count restorable entries."
