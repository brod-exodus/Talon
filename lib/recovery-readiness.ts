import { createHash } from "node:crypto"
import { createReadStream, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

export const BACKUP_RPO_MS = 24 * 60 * 60 * 1000
export const RESTORE_DRILL_MAX_AGE_MS = 92 * 24 * 60 * 60 * 1000
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000

const BACKUP_PATTERN = /^talon-public-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump$/
const EVIDENCE_PATTERN = /^talon-restore-drill-(\d+)\.json$/

export interface RecoveryReadiness {
  ready: boolean
  backup: {
    ready: boolean
    file: string | null
    createdAt: string | null
    ageHours: number | null
    checksumVerified: boolean
    issue: string | null
  }
  restoreDrill: {
    ready: boolean
    file: string | null
    finishedAt: string | null
    ageDays: number | null
    cleanupStatus: string | null
    issue: string | null
  }
}

function backupTimestamp(filename: string): number | null {
  const match = BACKUP_PATTERN.exec(filename)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const timestamp = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
  return Number.isFinite(timestamp) ? timestamp : null
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

function finiteDate(value: unknown): number | null {
  if (typeof value !== "string") return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export async function inspectRecoveryReadiness(
  backupDirectory: string,
  evidenceDirectory: string,
  now = Date.now(),
): Promise<RecoveryReadiness> {
  const backupCandidates = readdirSync(backupDirectory)
    .map((file) => ({ file, timestamp: backupTimestamp(file) }))
    .filter((candidate): candidate is { file: string; timestamp: number } => candidate.timestamp !== null)
    .sort((left, right) => right.timestamp - left.timestamp)

  const latestBackup = backupCandidates[0]
  let backup: RecoveryReadiness["backup"]
  if (!latestBackup) {
    backup = { ready: false, file: null, createdAt: null, ageHours: null, checksumVerified: false, issue: "No Talon logical backup was found" }
  } else {
    const path = join(backupDirectory, latestBackup.file)
    const checksumPath = `${path}.sha256`
    const ageMs = Math.max(0, now - latestBackup.timestamp)
    let checksumVerified = false
    let issue: string | null = null
    try {
      if (!statSync(path).isFile() || !statSync(checksumPath).isFile()) throw new Error("missing")
      const expected = readFileSync(checksumPath, "utf8").trim().split(/\s+/)[0]?.toLowerCase()
      checksumVerified = Boolean(expected && /^[a-f0-9]{64}$/.test(expected) && await sha256(path) === expected)
      if (!checksumVerified) issue = "The newest backup checksum is missing or invalid"
    } catch {
      issue = "The newest backup checksum is missing or invalid"
    }
    if (!issue && latestBackup.timestamp > now + CLOCK_SKEW_TOLERANCE_MS) issue = "The newest backup timestamp is in the future"
    if (!issue && ageMs > BACKUP_RPO_MS) issue = "The newest backup is older than the 24-hour recovery-point target"
    backup = {
      ready: issue === null,
      file: latestBackup.file,
      createdAt: new Date(latestBackup.timestamp).toISOString(),
      ageHours: Math.round((ageMs / (60 * 60 * 1000)) * 10) / 10,
      checksumVerified,
      issue,
    }
  }

  const evidenceCandidates = readdirSync(evidenceDirectory)
    .map((file) => {
      const filenameMatch = EVIDENCE_PATTERN.exec(file)
      if (!filenameMatch) return null
      const filenameEpoch = Number(filenameMatch[1])
      try {
        const parsed = JSON.parse(readFileSync(join(evidenceDirectory, file), "utf8")) as Record<string, unknown>
        return { file, parsed, timestamp: finiteDate(parsed.finishedAt), filenameEpoch }
      } catch {
        return { file, parsed: null, timestamp: null, filenameEpoch }
      }
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.filenameEpoch - left.filenameEpoch)

  const latestEvidence = evidenceCandidates[0]
  let restoreDrill: RecoveryReadiness["restoreDrill"]
  if (!latestEvidence) {
    restoreDrill = { ready: false, file: null, finishedAt: null, ageDays: null, cleanupStatus: null, issue: "No restore-drill evidence was found" }
  } else if (!latestEvidence.parsed || latestEvidence.timestamp === null) {
    restoreDrill = { ready: false, file: latestEvidence.file, finishedAt: null, ageDays: null, cleanupStatus: null, issue: "The newest restore-drill evidence is malformed" }
  } else {
    const ageMs = Math.max(0, now - latestEvidence.timestamp)
    const cleanupStatus = typeof latestEvidence.parsed.cleanupStatus === "string" ? latestEvidence.parsed.cleanupStatus : null
    let issue: string | null = null
    if (latestEvidence.timestamp > now + CLOCK_SKEW_TOLERANCE_MS) {
      issue = "The newest restore-drill timestamp is in the future"
    } else if (latestEvidence.parsed.version !== 1 || latestEvidence.parsed.status !== "succeeded") {
      issue = "The newest restore drill did not succeed"
    } else if (ageMs > RESTORE_DRILL_MAX_AGE_MS) {
      issue = "The newest successful restore drill is older than the quarterly target"
    }
    restoreDrill = {
      ready: issue === null,
      file: latestEvidence.file,
      finishedAt: new Date(latestEvidence.timestamp).toISOString(),
      ageDays: Math.round((ageMs / (24 * 60 * 60 * 1000)) * 10) / 10,
      cleanupStatus,
      issue,
    }
  }

  return { ready: backup.ready && restoreDrill.ready, backup, restoreDrill }
}

export function recoveryReadinessSummary(result: RecoveryReadiness): string[] {
  const backupDetail = result.backup.file
    ? `${result.backup.file}; ${result.backup.ageHours} hours old; checksum ${result.backup.checksumVerified ? "verified" : "not verified"}`
    : result.backup.issue ?? "unavailable"
  const drillDetail = result.restoreDrill.file
    ? `${result.restoreDrill.file}; ${result.restoreDrill.ageDays} days old; cleanup ${result.restoreDrill.cleanupStatus ?? "unrecorded"}`
    : result.restoreDrill.issue ?? "unavailable"
  return [
    `Backup: ${result.backup.ready ? "PASS" : "FAIL"} — ${result.backup.issue ?? backupDetail}`,
    `Restore drill: ${result.restoreDrill.ready ? "PASS" : "FAIL"} — ${result.restoreDrill.issue ?? drillDetail}`,
    `Recovery readiness: ${result.ready ? "PASS" : "FAIL"}`,
  ]
}
