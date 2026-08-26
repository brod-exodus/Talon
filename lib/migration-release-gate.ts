export const MIGRATION_APPLIED_CHECKBOX = "Required DB migrations were applied"

export type MigrationReleaseGateResult = {
  ready: boolean
  addedMigrations: string[]
  missingBodyEntries: string[]
  reason: "no_migrations" | "unchecked" | "missing_entries" | "ready"
}

export function evaluateMigrationReleaseGate(input: {
  addedFiles: string[]
  pullRequestBody: string
}): MigrationReleaseGateResult {
  const addedMigrations = [...new Set(input.addedFiles)]
    .filter((file) => /^db\/migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort()

  if (addedMigrations.length === 0) {
    return { ready: true, addedMigrations, missingBodyEntries: [], reason: "no_migrations" }
  }

  const checkbox = new RegExp(
    `^\\s*-\\s*\\[[xX]\\]\\s+${MIGRATION_APPLIED_CHECKBOX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "m"
  )
  if (!checkbox.test(input.pullRequestBody)) {
    return { ready: false, addedMigrations, missingBodyEntries: [], reason: "unchecked" }
  }

  const missingBodyEntries = addedMigrations.filter((file) => !input.pullRequestBody.includes(`\`${file}\``))
  if (missingBodyEntries.length > 0) {
    return { ready: false, addedMigrations, missingBodyEntries, reason: "missing_entries" }
  }

  return { ready: true, addedMigrations, missingBodyEntries: [], reason: "ready" }
}
