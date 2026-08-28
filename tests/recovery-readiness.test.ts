import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { inspectRecoveryReadiness } from "../lib/recovery-readiness.ts"

const now = Date.parse("2026-08-28T12:00:00.000Z")

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "talon-recovery-readiness-"))
  const backups = join(root, "backups")
  const evidence = join(root, "evidence")
  mkdirSync(backups)
  mkdirSync(evidence)
  return { backups, evidence }
}

function backup(directory: string, timestamp: string, contents = "verified backup") {
  const file = `talon-public-${timestamp}.dump`
  writeFileSync(join(directory, file), contents)
  const checksum = createHash("sha256").update(contents).digest("hex")
  writeFileSync(join(directory, `${file}.sha256`), `${checksum}  ${file}\n`)
}

function drill(directory: string, epoch: number, overrides: Record<string, unknown> = {}) {
  writeFileSync(join(directory, `talon-restore-drill-${epoch}.json`), JSON.stringify({
    version: 1,
    status: "succeeded",
    finishedAt: new Date(epoch * 1000).toISOString(),
    cleanupStatus: "operator_required",
    ...overrides,
  }))
}

test("fresh verified backup and quarterly restore evidence are ready", async () => {
  const directories = fixture()
  backup(directories.backups, "20260828T060000Z")
  drill(directories.evidence, Date.parse("2026-07-01T12:00:00Z") / 1000)

  const result = await inspectRecoveryReadiness(directories.backups, directories.evidence, now)
  assert.equal(result.ready, true)
  assert.equal(result.backup.checksumVerified, true)
  assert.equal(result.restoreDrill.cleanupStatus, "operator_required")
})

test("stale backup fails the 24-hour recovery-point target", async () => {
  const directories = fixture()
  backup(directories.backups, "20260826T060000Z")
  drill(directories.evidence, Date.parse("2026-08-01T12:00:00Z") / 1000)

  const result = await inspectRecoveryReadiness(directories.backups, directories.evidence, now)
  assert.equal(result.ready, false)
  assert.match(result.backup.issue ?? "", /older than the 24-hour/)
})

test("invalid newest checksum fails even when an older backup is valid", async () => {
  const directories = fixture()
  backup(directories.backups, "20260828T010000Z")
  backup(directories.backups, "20260828T110000Z")
  writeFileSync(join(directories.backups, "talon-public-20260828T110000Z.dump.sha256"), `${"0".repeat(64)}  wrong.dump\n`)
  drill(directories.evidence, Date.parse("2026-08-01T12:00:00Z") / 1000)

  const result = await inspectRecoveryReadiness(directories.backups, directories.evidence, now)
  assert.equal(result.ready, false)
  assert.match(result.backup.issue ?? "", /checksum/)
})

test("newest failed or malformed drill evidence fails closed", async () => {
  const directories = fixture()
  backup(directories.backups, "20260828T060000Z")
  drill(directories.evidence, Date.parse("2026-08-01T12:00:00Z") / 1000)
  drill(directories.evidence, Date.parse("2026-08-28T10:00:00Z") / 1000, { status: "failed" })

  let result = await inspectRecoveryReadiness(directories.backups, directories.evidence, now)
  assert.equal(result.ready, false)
  assert.match(result.restoreDrill.issue ?? "", /did not succeed/)

  writeFileSync(join(directories.evidence, "talon-restore-drill-9999999999.json"), "not json")
  result = await inspectRecoveryReadiness(directories.backups, directories.evidence, now)
  assert.equal(result.ready, false)
  assert.match(result.restoreDrill.issue ?? "", /malformed/)
})

test("future-dated backup and drill evidence fail closed", async () => {
  const directories = fixture()
  backup(directories.backups, "20260829T120000Z")
  drill(directories.evidence, Date.parse("2026-08-29T12:00:00Z") / 1000)

  const result = await inspectRecoveryReadiness(directories.backups, directories.evidence, now)
  assert.equal(result.ready, false)
  assert.match(result.backup.issue ?? "", /future/)
  assert.match(result.restoreDrill.issue ?? "", /future/)
})
