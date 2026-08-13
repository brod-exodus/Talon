const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export type OriginRequest = {
  headers: Pick<Headers, "get">
  method: string
  nextUrl: Pick<URL, "origin">
}

export function isTrustedRequestOrigin(request: OriginRequest): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase()
  if (fetchSite === "cross-site") return false

  const origin = request.headers.get("origin")
  const candidate = origin ?? request.headers.get("referer")
  if (!candidate) return false

  try {
    return new URL(candidate).origin === request.nextUrl.origin
  } catch {
    return false
  }
}
