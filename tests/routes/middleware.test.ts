import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"
import { createSessionToken } from "@/lib/auth-token"
import { verifyMiddlewareSessionToken } from "@/lib/middleware-auth"
import { config, middleware, PROTECTED_PATHS } from "@/middleware"

const sessionSecret = "test-session-secret-at-least-32-characters"

function pageRequest(path: string, token?: string) {
  return new NextRequest(`https://talon.example${path}`, {
    headers: token ? { cookie: `talon_session=${token}` } : undefined,
  })
}

const REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

describe("protected-page middleware", () => {
  beforeEach(() => {
    vi.stubEnv("TALON_SESSION_SECRET", sessionSecret)
    vi.stubEnv("TALON_ADMIN_PASSWORD", "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test.each([
    "/",
    "/contributors/contributor-1",
    "/ecosystems/project-1",
    "/pipeline",
    "/settings",
    "/watched",
  ])("redirects an anonymous request for %s", async (path) => {
    const response = await middleware(pageRequest(path))

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get("location") ?? "")
    expect(location.pathname).toBe("/login")
    expect(location.searchParams.get("next")).toBe(path)
  })

  test("preserves the protected destination query string", async () => {
    const response = await middleware(pageRequest("/pipeline?status=contacted"))

    const location = new URL(response.headers.get("location") ?? "")
    expect(location.searchParams.get("next")).toBe("/pipeline?status=contacted")
  })

  test("allows a valid signed session", async () => {
    const token = createSessionToken({
      actor: "user",
      email: "recruiter@example.com",
      teamId: "team-1",
      teamSlug: "engineering",
      role: "recruiter",
    })

    const response = await middleware(pageRequest("/pipeline", token))

    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  test("redirects a tampered session instead of trusting cookie presence", async () => {
    const token = `${createSessionToken()}tampered`

    const response = await middleware(pageRequest("/settings", token))

    expect(response.status).toBe(307)
  })

  test("rejects an otherwise valid token after its expiry", async () => {
    const token = createSessionToken()

    expect(await verifyMiddlewareSessionToken(token, sessionSecret, 9999999999)).toBe(false)
  })

  test("leaves public pages outside the protected route set", async () => {
    const response = await middleware(pageRequest("/login"))

    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })

  test("propagates a valid request ID to the application and response", async () => {
    const request = new NextRequest("https://talon.example/api/health", {
      headers: { "X-Request-ID": REQUEST_ID },
    })

    const response = await middleware(request)

    expect(response.headers.get("x-request-id")).toBe(REQUEST_ID)
    expect(response.headers.get("x-middleware-request-x-request-id")).toBe(REQUEST_ID)
  })

  test("replaces an invalid caller-supplied request ID", async () => {
    const request = new NextRequest("https://talon.example/api/health", {
      headers: { "X-Request-ID": "not-safe-log-entry" },
    })

    const response = await middleware(request)
    const requestId = response.headers.get("x-request-id")

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(requestId).not.toContain("not-safe")
  })

  test("keeps the protected route declaration aligned with the matcher", () => {
    expect(PROTECTED_PATHS).toEqual(["/", "/contributors", "/ecosystems", "/pipeline", "/settings", "/watched"])
    expect(config.matcher).toEqual([
      "/",
      "/contributors/:path*",
      "/ecosystems/:path*",
      "/pipeline/:path*",
      "/settings/:path*",
      "/watched/:path*",
      "/api/:path*",
    ])
  })
})
