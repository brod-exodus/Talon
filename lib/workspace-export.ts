const EXPORT_FIELDS = {
  members: ["id", "email", "displayName", "role", "createdAt"],
  contributors: [
    "id", "githubUsername", "name", "avatarUrl", "bio", "location", "company",
    "email", "twitter", "linkedin", "website", "contacted", "contactedDate",
    "outreachNotes", "outreachNotesUpdatedAt", "status", "reminderNote",
    "reminderDate", "reminderUpdatedAt", "createdAt", "updatedAt",
  ],
  scrapes: [
    "id", "type", "target", "status", "progress", "current", "total",
    "startedAt", "completedAt", "minContributions", "contactInfoCount", "totalContributors",
  ],
  scrapeContributors: ["scrapeId", "contributorId", "contributions"],
  projects: ["id", "name", "createdAt"],
  projectScrapes: ["projectId", "scrapeId", "createdAt"],
  projectLists: ["id", "projectId", "name", "createdAt", "updatedAt"],
  projectListContributors: ["listId", "contributorId", "createdAt"],
  projectTracking: [
    "id", "projectId", "contributorId", "status", "notes", "lastContactedAt",
    "nextFollowUpAt", "createdAt", "updatedAt",
  ],
  sharedLinks: [
    "scrapeId", "createdAt", "expiresAt", "revokedAt", "allowDownload",
    "lastAccessedAt", "accessCount",
  ],
  watchedRepositories: ["id", "repository", "intervalHours", "active", "lastCheckedAt", "createdAt"],
  watchedContributors: ["watchedRepositoryId", "githubUsername", "firstSeenAt", "detectedScrapeId"],
} as const

export const MAX_IMMEDIATE_WORKSPACE_EXPORT_BYTES = 4 * 1024 * 1024

type JsonScalar = string | number | boolean | null

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value as Record<string, unknown>
}

function scalar(value: unknown, label: string): JsonScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  throw new Error(`Invalid ${label}`)
}

function exportedRows(
  value: unknown,
  fields: readonly string[],
  label: string
): Array<Record<string, JsonScalar>> {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value.map((row, index) => {
    const source = record(row, `${label} row`)
    return Object.fromEntries(
      fields.map((field) => [field, scalar(source[field], `${label}[${index}].${field}`)])
    )
  })
}

export function normalizeWorkspaceExport(value: unknown) {
  const source = record(value, "workspace export")
  const workspace = record(source.workspace, "workspace export workspace")
  const data = record(source.data, "workspace export data")
  const generatedAt = typeof source.generatedAt === "string" ? source.generatedAt : ""

  if (source.format !== "talon-workspace-export" || source.version !== 1) {
    throw new Error("Unsupported workspace export format")
  }
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error("Invalid workspace export timestamp")
  }
  if (typeof workspace.name !== "string" || typeof workspace.kind !== "string") {
    throw new Error("Invalid workspace export workspace")
  }

  return {
    format: "talon-workspace-export",
    version: 1,
    generatedAt,
    workspace: { name: workspace.name, kind: workspace.kind },
    data: Object.fromEntries(
      Object.entries(EXPORT_FIELDS).map(([key, fields]) => [
        key,
        exportedRows(data[key], fields, key),
      ])
    ),
    excluded: [
      "supabase_auth", "profile_photo_storage", "operational_history",
      "auth_sessions", "derived_caches", "encrypted_backups", "secrets",
    ],
  }
}

export function serializeWorkspaceExport(value: unknown): { body: string; bytes: number } {
  const body = `${JSON.stringify(normalizeWorkspaceExport(value), null, 2)}\n`
  return { body, bytes: new TextEncoder().encode(body).byteLength }
}
