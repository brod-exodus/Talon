const NEW_YORK_CITY_QUERY_ALIASES = new Set(["nyc", "new york", "new york city"])

const NEW_YORK_CITY_LOCATION_TERMS = [
  "nyc",
  "new york",
  "new york city",
  "manhattan",
  "brooklyn",
  "queens",
  "bronx",
  "staten island",
]

function normalizeLocationText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function containsWholeTerm(value: string, term: string): boolean {
  return ` ${value} `.includes(` ${term} `)
}

/** Match only the location text a contributor chose to publish on GitHub. */
export function contributorMatchesLocation(
  location: string | null | undefined,
  rawQuery: string
): boolean {
  const query = normalizeLocationText(rawQuery)
  if (!query) return true
  if (!location?.trim()) return false

  const normalizedLocation = normalizeLocationText(location)
  if (NEW_YORK_CITY_QUERY_ALIASES.has(query)) {
    return NEW_YORK_CITY_LOCATION_TERMS.some((term) => containsWholeTerm(normalizedLocation, term))
  }

  return normalizedLocation.includes(query)
}
