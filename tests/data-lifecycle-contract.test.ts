import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "..")
const migrationsDirectory = resolve(root, "db/migrations")
const lifecycle = readFileSync(resolve(root, "docs/data-lifecycle.md"), "utf8")

function schemaTables(): string[] {
  const tables = new Set<string>()
  const createTable = /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?([a-z_]+)/gi

  for (const file of readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql"))) {
    const migration = readFileSync(resolve(migrationsDirectory, file), "utf8")
    for (const match of migration.matchAll(createTable)) tables.add(match[1])
  }

  return [...tables].sort()
}

function inventoriedTables(): string[] {
  return [...lifecycle.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]).sort()
}

test("every Talon Postgres table has exactly one documented lifecycle", () => {
  const schema = schemaTables()
  const inventory = inventoriedTables()

  assert.equal(new Set(inventory).size, inventory.length, "lifecycle inventory contains a duplicate table")
  assert.deepEqual(inventory, schema)
})

test("the lifecycle contract preserves privacy and deletion boundaries", () => {
  assert.match(lifecycle, /Public GitHub profiles and contact details are still personal data/)
  assert.match(lifecycle, /private recruiter notes and reminders/)
  assert.match(lifecycle, /Supabase Auth identities are not in Talon's logical database backup/)
  assert.match(lifecycle, /Supabase Storage profile photos are outside the Postgres table inventory/)
  assert.match(lifecycle, /Talon cannot erase an offline copy it does not control/)
  assert.match(lifecycle, /available only to a signed-in owner/)
  assert.match(lifecycle, /deletes all Postgres-owned workspace data in one\s+transaction/)
  assert.match(lifecycle, /path-free successful evidence expires after 90 days/)
  assert.match(lifecycle, /Supabase Auth identities are intentionally retained/)
})
