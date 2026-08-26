import { readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import {
  MAX_IMMEDIATE_WORKSPACE_EXPORT_BYTES,
  verifyWorkspaceExport,
} from "../lib/workspace-export.ts"

const input = process.argv[2]
if (!input) {
  console.error("Usage: pnpm export:verify -- /absolute/path/to/talon-workspace-export-YYYY-MM-DD.json")
  process.exit(1)
}

function fail(message: string): never {
  console.error(`Workspace export verification failed: ${message}`)
  process.exit(1)
}

const path = resolve(input)
let contents: string
try {
  const size = statSync(path).size
  if (size < 1 || size > MAX_IMMEDIATE_WORKSPACE_EXPORT_BYTES) {
    fail("Export file size is outside the supported range")
  }
  contents = readFileSync(path, "utf8")
} catch {
  fail("Export file could not be read")
}

let parsed: unknown
try {
  parsed = JSON.parse(contents)
} catch {
  fail("Export file is not valid JSON")
}

let result: ReturnType<typeof verifyWorkspaceExport>
try {
  result = verifyWorkspaceExport(parsed)
} catch (error) {
  fail(error instanceof Error ? error.message : "Unknown validation failure")
}

const totalRows = Object.values(result.counts).reduce((total, count) => total + count, 0)
console.log(`Workspace export verified: format v${result.formatVersion}, ${totalRows} rows, generated ${result.generatedAt}.`)
