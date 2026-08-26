export const WORKSPACE_EXPORT_FIELDS = {
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

const WORKSPACE_EXPORT_EXCLUSIONS = [
  "supabase_auth", "profile_photo_storage", "operational_history",
  "auth_sessions", "derived_caches", "encrypted_backups", "secrets",
] as const

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
      Object.entries(WORKSPACE_EXPORT_FIELDS).map(([key, fields]) => [
        key,
        exportedRows(data[key], fields, key),
      ])
    ),
    excluded: [...WORKSPACE_EXPORT_EXCLUSIONS],
  }
}

export function serializeWorkspaceExport(value: unknown): { body: string; bytes: number } {
  const body = `${JSON.stringify(normalizeWorkspaceExport(value), null, 2)}\n`
  return { body, bytes: new TextEncoder().encode(body).byteLength }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Unexpected fields in ${label}`)
  }
}

function requiredId(row: Record<string, JsonScalar>, field: string, label: string): string {
  const value = row[field]
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Invalid ${label}.${field}`)
  return value
}

function uniqueIds(rows: Array<Record<string, JsonScalar>>, field: string, label: string): Set<string> {
  const ids = new Set<string>()
  rows.forEach((row, index) => {
    const id = requiredId(row, field, `${label}[${index}]`)
    if (ids.has(id)) throw new Error(`Duplicate ${label}.${field}`)
    ids.add(id)
  })
  return ids
}

function requireReference(ids: Set<string>, value: string, label: string): void {
  if (!ids.has(value)) throw new Error(`Missing reference for ${label}`)
}

export function verifyWorkspaceExport(value: unknown) {
  const raw = record(value, "workspace export")
  assertExactKeys(raw, ["format", "version", "generatedAt", "workspace", "data", "excluded"], "workspace export")
  const rawWorkspace = record(raw.workspace, "workspace export workspace")
  assertExactKeys(rawWorkspace, ["name", "kind"], "workspace export workspace")
  const rawData = record(raw.data, "workspace export data")
  assertExactKeys(rawData, Object.keys(WORKSPACE_EXPORT_FIELDS), "workspace export data")
  for (const [key, fields] of Object.entries(WORKSPACE_EXPORT_FIELDS)) {
    const rows = rawData[key]
    if (!Array.isArray(rows)) throw new Error(`Invalid ${key}`)
    rows.forEach((row, index) => {
      assertExactKeys(record(row, `${key} row`), fields, `${key}[${index}]`)
    })
  }
  if (!Array.isArray(raw.excluded)
    || raw.excluded.length !== WORKSPACE_EXPORT_EXCLUSIONS.length
    || raw.excluded.some((item, index) => item !== WORKSPACE_EXPORT_EXCLUSIONS[index])) {
    throw new Error("Invalid workspace export exclusions")
  }

  const normalized = normalizeWorkspaceExport(raw)
  const data = normalized.data as Record<string, Array<Record<string, JsonScalar>>>
  const contributorIds = uniqueIds(data.contributors, "id", "contributors")
  const scrapeIds = uniqueIds(data.scrapes, "id", "scrapes")
  const projectIds = uniqueIds(data.projects, "id", "projects")
  const listIds = uniqueIds(data.projectLists, "id", "projectLists")
  const watchedRepositoryIds = uniqueIds(data.watchedRepositories, "id", "watchedRepositories")
  uniqueIds(data.members, "id", "members")
  uniqueIds(data.projectTracking, "id", "projectTracking")

  data.scrapeContributors.forEach((row, index) => {
    requireReference(scrapeIds, requiredId(row, "scrapeId", `scrapeContributors[${index}]`), "scrapeContributors.scrapeId")
    requireReference(contributorIds, requiredId(row, "contributorId", `scrapeContributors[${index}]`), "scrapeContributors.contributorId")
  })
  data.projectScrapes.forEach((row, index) => {
    requireReference(projectIds, requiredId(row, "projectId", `projectScrapes[${index}]`), "projectScrapes.projectId")
    requireReference(scrapeIds, requiredId(row, "scrapeId", `projectScrapes[${index}]`), "projectScrapes.scrapeId")
  })
  data.projectLists.forEach((row, index) => {
    requireReference(projectIds, requiredId(row, "projectId", `projectLists[${index}]`), "projectLists.projectId")
  })
  data.projectListContributors.forEach((row, index) => {
    requireReference(listIds, requiredId(row, "listId", `projectListContributors[${index}]`), "projectListContributors.listId")
    requireReference(contributorIds, requiredId(row, "contributorId", `projectListContributors[${index}]`), "projectListContributors.contributorId")
  })
  data.projectTracking.forEach((row, index) => {
    requireReference(projectIds, requiredId(row, "projectId", `projectTracking[${index}]`), "projectTracking.projectId")
    requireReference(contributorIds, requiredId(row, "contributorId", `projectTracking[${index}]`), "projectTracking.contributorId")
  })
  data.sharedLinks.forEach((row, index) => {
    requireReference(scrapeIds, requiredId(row, "scrapeId", `sharedLinks[${index}]`), "sharedLinks.scrapeId")
  })
  data.watchedContributors.forEach((row, index) => {
    requireReference(
      watchedRepositoryIds,
      requiredId(row, "watchedRepositoryId", `watchedContributors[${index}]`),
      "watchedContributors.watchedRepositoryId"
    )
    const detectedScrapeId = row.detectedScrapeId
    if (detectedScrapeId !== null) {
      requireReference(
        scrapeIds,
        requiredId(row, "detectedScrapeId", `watchedContributors[${index}]`),
        "watchedContributors.detectedScrapeId"
      )
    }
  })

  return {
    formatVersion: normalized.version,
    generatedAt: normalized.generatedAt,
    counts: Object.fromEntries(Object.keys(WORKSPACE_EXPORT_FIELDS).map((key) => [key, data[key].length])),
  }
}
