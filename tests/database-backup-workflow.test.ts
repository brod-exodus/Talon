import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { resolve } from "node:path"

const backup = readFileSync(resolve(import.meta.dirname, "../scripts/backup-database.sh"), "utf8")
const verify = readFileSync(resolve(import.meta.dirname, "../scripts/verify-database-backup.sh"), "utf8")
const runbook = readFileSync(resolve(import.meta.dirname, "../docs/disaster-recovery.md"), "utf8")

test("database backup is private, atomic, repository-external, and structurally verified", () => {
  assert.match(backup, /umask 077/)
  assert.match(backup, /--schema=public/)
  assert.match(backup, /\.dump\.partial/)
  assert.match(backup, /pg_restore --list "\$partial_file"/)
  assert.match(backup, /output_dir\/.*repository_root/)
  assert.match(backup, /chmod 600 "\$backup_file"/)
  assert.match(backup, /sha256sum|shasum -a 256/)
  assert.doesNotMatch(backup, /echo[^\n]*\$\{?TALON_BACKUP_DATABASE_URL/)
})

test("backup verification checks both checksum and PostgreSQL archive contents", () => {
  assert.match(verify, /actual.*expected|"\$actual" != "\$expected"/s)
  assert.match(verify, /pg_restore --list "\$backup_file"/)
  assert.match(verify, /entry_count.*-lt 1/s)
})

test("recovery requires an isolated restore and inventories non-database state", () => {
  assert.match(runbook, /Never test a restore against Production/)
  assert.match(runbook, /Supabase Auth identities.*not included/i)
  assert.match(runbook, /Vault.*worker schedule/i)
  assert.match(runbook, /get_talon_schema_contract_issues/)
  assert.match(runbook, /normal stale-lease recovery/)
  assert.match(runbook, /A checksum check alone is not a restore drill/)
})
