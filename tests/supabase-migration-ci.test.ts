import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { prepareSupabaseMigrations } from "../scripts/prepare-supabase-migrations.ts"

const root = resolve(import.meta.dirname, "..")

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8")
}

test("migration preparation preserves every canonical migration in Supabase order", () => {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), "talon-supabase-migrations-"))
  const destination = resolve(temporaryRoot, "supabase/migrations")

  try {
    const generated = prepareSupabaseMigrations(destination)
    const canonical = readdirSync(resolve(root, "db/migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort()

    assert.equal(generated.length, canonical.length)
    assert.deepEqual(readdirSync(destination).sort(), generated)

    for (const [index, canonicalFile] of canonical.entries()) {
      assert.equal(
        readFileSync(resolve(destination, generated[index]), "utf8"),
        readFileSync(resolve(root, "db/migrations", canonicalFile), "utf8")
      )
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test("migration preparation rejects untracked SQL in its destination", () => {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), "talon-supabase-migrations-"))

  try {
    writeFileSync(resolve(temporaryRoot, "99999999999999_untracked.sql"), "select 1;\n")
    assert.throws(
      () => prepareSupabaseMigrations(temporaryRoot),
      /contains unexpected SQL files: 99999999999999_untracked\.sql/
    )
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test("CI executes all migrations against a fresh pinned Supabase database", () => {
  const workflow = read(".github/workflows/ci.yml")
  const databaseJob = workflow.slice(
    workflow.indexOf("  database-migrations:"),
    workflow.indexOf("  verify:")
  )

  assert.notEqual(databaseJob, "")
  assert.match(databaseJob, /supabase\/setup-cli@3c2f5e2ae34c34e428e8e206e2c4d21fa2d20fbf/)
  assert.match(databaseJob, /version: 2\.114\.0/)
  assert.match(databaseJob, /prepare-supabase-migrations\.ts/)
  assert.match(databaseJob, /supabase db start --workdir/)
  assert.match(databaseJob, /tests\/integration\/worker-fault-injection\.sql/)
  assert.match(databaseJob, /tests\/integration\/workspace-lifecycle-preview\.sql/)
  assert.match(databaseJob, /tests\/integration\/workspace-data-export\.sql/)
  assert.match(databaseJob, /tests\/integration\/workspace-deletion\.sql/)
  assert.match(databaseJob, /worker-fault-injection\.log/)
  assert.match(databaseJob, /supabase stop --workdir/)
  assert.doesNotMatch(databaseJob, /SUPABASE_(?:SERVICE_ROLE_KEY|ACCESS_TOKEN)/)
})
