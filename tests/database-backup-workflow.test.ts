import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const backup = readFileSync(resolve(import.meta.dirname, "../scripts/backup-database.sh"), "utf8")
const verify = readFileSync(resolve(import.meta.dirname, "../scripts/verify-database-backup.sh"), "utf8")
const drill = readFileSync(resolve(import.meta.dirname, "../scripts/drill-database-restore.sh"), "utf8")
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

test("restore drills fail closed before touching an ambiguous or populated target", () => {
  assert.match(drill, /talon-recovery-drill-/)
  assert.match(drill, /TALON_RESTORE_CONFIRMATION/)
  assert.match(drill, /TALON_PRODUCTION_DATABASE_HOST/)
  assert.match(drill, /target_host.*production_host/s)
  assert.match(drill, /preexisting_tables.*-ne 0/s)
  assert.doesNotMatch(drill, /pg_restore[^\n]*--clean/)
  assert.doesNotMatch(drill, /echo[^\n]*\$target_url/)
})

test("restore drills refuse the recorded production hostname without leaking credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "talon-restore-safety-"))
  const backupFile = join(directory, "talon-public-20260825T120000Z.dump")
  writeFileSync(backupFile, "not reached")
  const password = "must-not-appear"
  const result = spawnSync("bash", [resolve(import.meta.dirname, "../scripts/drill-database-restore.sh"), backupFile], {
    encoding: "utf8",
    env: {
      ...process.env,
      TALON_RESTORE_TARGET_NAME: "talon-recovery-drill-safety-test",
      TALON_RESTORE_CONFIRMATION: "RESTORE talon-recovery-drill-safety-test",
      TALON_RESTORE_DATABASE_URL: `postgresql://postgres:${password}@production.example.com/postgres`,
      TALON_PRODUCTION_DATABASE_HOST: "production.example.com",
      TALON_RESTORE_EVIDENCE_DIR: join(directory, "evidence"),
    },
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /target hostname matches the recorded production hostname/)
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(password))
})

test("restore drills verify the archive, restore transactionally, and record recovery evidence", () => {
  assert.match(drill, /verify-database-backup\.sh/)
  assert.match(drill, /pg_restore --list "\$backup_file"[\s\S]+SCHEMA - public/)
  assert.match(drill, /pg_restore --no-owner --no-acl --use-list="\$restore_toc" --file=-/)
  assert.match(drill, /psql[^\n]*--single-transaction/)
  assert.match(drill, /get_talon_schema_version/)
  assert.match(drill, /get_talon_schema_contract_issues/)
  assert.match(drill, /get_talon_append_only_contract_issues/)
  assert.match(drill, /get_talon_session_contract_issues/)
  assert.match(drill, /get_talon_session_limit_contract_issues/)
  assert.match(drill, /get_talon_scheduling_contract_issues/)
  assert.match(drill, /get_talon_lifecycle_contract_issues/)
  assert.match(drill, /EXPECTED_SCHEMA_VERSION/)
  assert.match(drill, /scrapes[\s\S]+contributors[\s\S]+ecosystems[\s\S]+team_memberships/)
  assert.match(drill, /elapsedSeconds/)
  assert.match(drill, /ageSecondsAtStart/)
  assert.match(drill, /cleanupStatus/)
  assert.match(drill, /trap on_exit EXIT/)
})
