import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import {
  evaluateMigrationReleaseGate,
  MIGRATION_APPLIED_CHECKBOX,
} from "../lib/migration-release-gate.ts"

test("migration-free pull requests pass without an operator acknowledgement", () => {
  const result = evaluateMigrationReleaseGate({
    addedFiles: ["app/page.tsx", "docs/ops.md"],
    pullRequestBody: "",
  })

  assert.equal(result.ready, true)
  assert.equal(result.reason, "no_migrations")
  assert.deepEqual(result.addedMigrations, [])
})

test("an unchecked migration acknowledgement blocks release readiness", () => {
  const result = evaluateMigrationReleaseGate({
    addedFiles: ["db/migrations/050_example.sql"],
    pullRequestBody: `- [ ] ${MIGRATION_APPLIED_CHECKBOX}\n\n- \`db/migrations/050_example.sql\``,
  })

  assert.equal(result.ready, false)
  assert.equal(result.reason, "unchecked")
})

test("a checked acknowledgement must list every added migration exactly", () => {
  const result = evaluateMigrationReleaseGate({
    addedFiles: [
      "db/migrations/051_second.sql",
      "db/migrations/050_first.sql",
      "db/migrations/050_first.sql",
    ],
    pullRequestBody: `- [x] ${MIGRATION_APPLIED_CHECKBOX}\n\n- \`db/migrations/050_first.sql\``,
  })

  assert.equal(result.ready, false)
  assert.equal(result.reason, "missing_entries")
  assert.deepEqual(result.addedMigrations, [
    "db/migrations/050_first.sql",
    "db/migrations/051_second.sql",
  ])
  assert.deepEqual(result.missingBodyEntries, ["db/migrations/051_second.sql"])
})

test("checking None does not substitute for the migration acknowledgement", () => {
  const result = evaluateMigrationReleaseGate({
    addedFiles: ["db/migrations/050_example.sql"],
    pullRequestBody: "- [x] None\n\n- `db/migrations/050_example.sql`",
  })

  assert.equal(result.ready, false)
  assert.equal(result.reason, "unchecked")
})

test("all exact paths and a checked acknowledgement pass", () => {
  const result = evaluateMigrationReleaseGate({
    addedFiles: [
      "db/migrations/051_second.sql",
      "db/migrations/not_a_number.sql",
      "db/migrations/050_first.sql",
      "db/migrations/050_notes.txt",
    ],
    pullRequestBody: [
      `- [X] ${MIGRATION_APPLIED_CHECKBOX} (required to merge when this PR adds a migration; list every file below)`,
      "",
      "- `db/migrations/050_first.sql`",
      "- `db/migrations/051_second.sql`",
    ].join("\n"),
  })

  assert.equal(result.ready, true)
  assert.equal(result.reason, "ready")
  assert.deepEqual(result.addedMigrations, [
    "db/migrations/050_first.sql",
    "db/migrations/051_second.sql",
  ])
})

test("CI reruns the Verify gate when the pull request description changes", () => {
  const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8")
  const template = readFileSync(resolve(import.meta.dirname, "../.github/pull_request_template.md"), "utf8")

  assert.match(workflow, /types:\s*\[opened, synchronize, reopened, edited\]/)
  assert.match(workflow, /TALON_PR_BASE_SHA:\s*\$\{\{ github\.event\.pull_request\.base\.sha \}\}/)
  assert.match(workflow, /TALON_PR_HEAD_SHA:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}/)
  assert.match(workflow, /TALON_PR_BODY:\s*\$\{\{ github\.event\.pull_request\.body \}\}/)
  assert.match(workflow, /node --experimental-strip-types scripts\/check-pr-migration-readiness\.ts/)
  assert.match(template, /Editing this PR description reruns the release gate\./)
})
