import { statSync } from "node:fs"
import { resolve } from "node:path"
import { inspectRecoveryReadiness, recoveryReadinessSummary } from "../lib/recovery-readiness.ts"

const backupDirectory = process.argv[2]
const evidenceDirectory = process.argv[3]
const json = process.argv.includes("--json")

if (!backupDirectory || !evidenceDirectory) {
  console.error("Usage: pnpm backup:status -- /absolute/path/to/talon-backups /absolute/path/to/talon-recovery-evidence [--json]")
  process.exit(1)
}

function readableDirectory(input: string, label: string): string {
  const path = resolve(input)
  try {
    if (!statSync(path).isDirectory()) throw new Error("not a directory")
  } catch {
    console.error(`Recovery readiness failed: ${label} directory could not be read.`)
    process.exit(1)
  }
  return path
}

async function main() {
  try {
    const result = await inspectRecoveryReadiness(
      readableDirectory(backupDirectory, "backup"),
      readableDirectory(evidenceDirectory, "restore evidence"),
    )
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    else console.log(recoveryReadinessSummary(result).join("\n"))
    if (!result.ready) process.exitCode = 1
  } catch {
    console.error("Recovery readiness failed: backup or restore evidence could not be inspected.")
    process.exitCode = 1
  }
}

void main()
