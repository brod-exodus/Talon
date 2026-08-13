const SESSION_VERSION = 1
const USER_ROLES = new Set(["owner", "admin", "recruiter", "viewer"])

function decodeBase64Url(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    const binary = atob(padded)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

function hasValidPayload(payloadBytes: Uint8Array, nowSeconds: number): boolean {
  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>
    if (payload.version !== SESSION_VERSION) return false
    if (typeof payload.expiresAt !== "number" || payload.expiresAt <= nowSeconds) return false
    if (payload.actor === "admin") return true
    return payload.actor === "user" &&
      typeof payload.email === "string" &&
      typeof payload.teamId === "string" &&
      typeof payload.teamSlug === "string" &&
      typeof payload.role === "string" &&
      USER_ROLES.has(payload.role)
  } catch {
    return false
  }
}

/** Verify the existing HMAC session format using middleware-safe Web Crypto. */
export async function verifyMiddlewareSessionToken(
  token: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!token || !secret) return false
  const parts = token.split(".")
  if (parts.length !== 2) return false

  const [payloadValue, signatureValue] = parts
  const payloadBytes = decodeBase64Url(payloadValue)
  const signatureBytes = decodeBase64Url(signatureValue)
  if (!payloadBytes || !signatureBytes || !hasValidPayload(payloadBytes, nowSeconds)) return false

  try {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    )
    return await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(payloadValue))
  } catch {
    return false
  }
}
