import { spawnSync } from "node:child_process"
import { evaluateMigrationReleaseGate } from "../lib/migration-release-gate.ts"

const baseSha = process.env.TALON_PR_BASE_SHA ?? ""
const headSha = process.env.TALON_PR_HEAD_SHA ?? ""
const pullRequestBody = process.env.TALON_PR_BODY ?? ""

if (!/^[0-9a-f]{40}$/i.test(baseSha) || !/^[0-9a-f]{40}$/i.test(headSha)) {
  console.error("Migration release gate could not validate the pull request commits.")
  process.exit(1)
}

const diff = spawnSync(
  "git",
  ["diff", "--diff-filter=A", "--name-only", baseSha, headSha, "--", "db/migrations"],
  { encoding: "utf8" }
)
if (diff.status !== 0) {
  console.error("Migration release gate could not inspect the pull request diff.")
  process.exit(1)
}

const result = evaluateMigrationReleaseGate({
  addedFiles: diff.stdout.split("\n").map((file) => file.trim()).filter(Boolean),
  pullRequestBody,
})

if (result.reason === "no_migrations") {
  console.log("Migration release gate passed: this pull request adds no database migration.")
} else if (result.reason === "ready") {
  console.log(`Migration release gate passed: ${result.addedMigrations.length} applied migration(s) documented.`)
} else if (result.reason === "unchecked") {
  console.error("Migration release gate blocked: apply every new migration to Production, then check 'Required DB migrations were applied' in the pull request.")
  process.exit(1)
} else {
  console.error(`Migration release gate blocked: list these exact files under Migrations Applied: ${result.missingBodyEntries.join(", ")}`)
  process.exit(1)
}
