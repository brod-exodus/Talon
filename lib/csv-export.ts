export type CsvContributor = {
  username: string
  name: string
  contributions: number
  contacts?: {
    email?: string | null
    twitter?: string | null
    linkedin?: string | null
    website?: string | null
  }
  contacted?: boolean
  contactedDate?: string
  notes?: string
  status?: string | null
}

function csvCell(value: unknown): string {
  const text = String(value ?? "")
  return text.includes(",") || text.includes('"') || text.includes("\n")
    ? `"${text.replace(/"/g, '""')}"`
    : text
}

export function hasExportableContact(contributor: CsvContributor): boolean {
  return Boolean(
    contributor.contacts?.email?.trim() ||
      contributor.contacts?.twitter?.trim() ||
      contributor.contacts?.linkedin?.trim() ||
      contributor.contacts?.website?.trim()
  )
}

export function buildCsvContent(contributors: CsvContributor[]): string {
  const sorted = [...contributors].sort((a, b) => b.contributions - a.contributions)
  const headers = [
    "#",
    "Name",
    "Username",
    "GitHub Profile",
    "Contributions",
    "Email",
    "Twitter",
    "LinkedIn",
    "Website",
    "Contacted",
    "Contact Date",
    "Notes",
    "Status",
  ]
  const rows = sorted.map((contributor, index) => [
    index + 1,
    contributor.name,
    contributor.username,
    `https://github.com/${contributor.username}`,
    contributor.contributions,
    contributor.contacts?.email?.trim() || "",
    contributor.contacts?.twitter?.trim()
      ? `https://twitter.com/${contributor.contacts.twitter.trim()}`
      : "",
    contributor.contacts?.linkedin?.trim() || "",
    contributor.contacts?.website?.trim() || "",
    contributor.contacted ? "Yes" : "No",
    contributor.contactedDate || "",
    contributor.notes || "",
    contributor.status || "",
  ])

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")
}

/** Public-share export intentionally excludes all outreach and recruiter-only fields. */
export function buildPublicCsvContent(contributors: CsvContributor[]): string {
  const sorted = [...contributors].sort((a, b) => b.contributions - a.contributions)
  const headers = [
    "#",
    "Name",
    "Username",
    "GitHub Profile",
    "Contributions",
    "Email",
    "Twitter",
    "LinkedIn",
    "Website",
  ]
  const rows = sorted.map((contributor, index) => [
    index + 1,
    contributor.name,
    contributor.username,
    `https://github.com/${contributor.username}`,
    contributor.contributions,
    contributor.contacts?.email?.trim() || "",
    contributor.contacts?.twitter?.trim()
      ? `https://twitter.com/${contributor.contacts.twitter.trim()}`
      : "",
    contributor.contacts?.linkedin?.trim() || "",
    contributor.contacts?.website?.trim() || "",
  ])
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")
}
