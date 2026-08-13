import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema-version.ts"

const repositoryRoot = resolve(import.meta.dirname, "..")
const migrationsDirectory = resolve(repositoryRoot, "db/migrations")
const migrationPattern = /^(\d{3})_([a-z0-9_]+)\.sql$/

const files = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort()

const migrations = files.map((file) => {
  const match = migrationPattern.exec(file)
  if (!match) throw new Error(`Migration filename must use NNN_snake_case.sql: ${file}`)
  return { file, version: Number(match[1]), name: match[2] }
})

for (const [index, migration] of migrations.entries()) {
  const expectedVersion = index + 1
  if (migration.version !== expectedVersion) {
    throw new Error(
      `Migration sequence is not contiguous: expected ${String(expectedVersion).padStart(3, "0")}, found ${migration.file}`
    )
  }
}

const latest = migrations.at(-1)
if (!latest || latest.version !== EXPECTED_SCHEMA_VERSION) {
  throw new Error(
    `Application expects schema v${EXPECTED_SCHEMA_VERSION}, but latest migration is v${latest?.version ?? 0}`
  )
}

for (const migration of migrations.filter(({ version }) => version >= 27)) {
  const source = readFileSync(resolve(migrationsDirectory, migration.file), "utf8")
  const ledgerInsert = /INSERT INTO public\.talon_schema_migrations\s*\(version, name\)/i
  const escapedName = migration.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const ownEntry = new RegExp(`\\(${migration.version},\\s*'${escapedName}'\\)`)
  if (!ledgerInsert.test(source) || !ownEntry.test(source)) {
    throw new Error(`${migration.file} must record (${migration.version}, '${migration.name}') in talon_schema_migrations`)
  }
}

console.log(`Migration contract is valid through schema v${EXPECTED_SCHEMA_VERSION} (${migrations.length} files).`)
