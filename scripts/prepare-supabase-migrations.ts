import { copyFileSync, mkdirSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(import.meta.dirname, "..")
const sourceDirectory = resolve(repositoryRoot, "db/migrations")
const migrationPattern = /^(\d{3})_([a-z0-9_]+)\.sql$/

function supabaseFilename(filename: string): string {
  const match = migrationPattern.exec(filename)
  if (!match) {
    throw new Error(`Migration filename must use NNN_snake_case.sql: ${filename}`)
  }

  return `${match[1].padStart(14, "0")}_${match[2]}.sql`
}

export function prepareSupabaseMigrations(destinationDirectory: string): string[] {
  const sourceFiles = readdirSync(sourceDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort()

  const generatedFiles = sourceFiles.map(supabaseFilename)
  const generatedSet = new Set(generatedFiles)

  mkdirSync(destinationDirectory, { recursive: true })

  const unexpectedFiles = readdirSync(destinationDirectory)
    .filter((file) => file.endsWith(".sql") && !generatedSet.has(file))

  if (unexpectedFiles.length > 0) {
    throw new Error(
      `Supabase migration directory contains unexpected SQL files: ${unexpectedFiles.join(", ")}`
    )
  }

  for (const [index, sourceFile] of sourceFiles.entries()) {
    copyFileSync(
      resolve(sourceDirectory, sourceFile),
      resolve(destinationDirectory, generatedFiles[index])
    )
  }

  return generatedFiles
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  const destination = process.argv[2]
  if (!destination) {
    throw new Error(
      "Usage: node --experimental-strip-types scripts/prepare-supabase-migrations.ts <supabase-migrations-directory>"
    )
  }

  const generated = prepareSupabaseMigrations(resolve(destination))
  console.log(`Prepared ${generated.length} migrations for a fresh Supabase database.`)
}
