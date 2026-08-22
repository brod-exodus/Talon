import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

type QueueRow = {
  status: "queued" | "running" | "failed"
  created_at: string
  run_after: string
  locked_at: string | null
}

type SloRow = {
  status: "completed" | "failed"
  started_at: string
  completed_at: string | null
}

const healthMocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  state: {
    databaseError: null as Error | null,
    schemaVersion: 46 as number | null,
    schemaError: null as Error | null,
    schemaContractIssues: [] as Array<{ requirement_type: string; requirement_name: string }>,
    schemaContractError: null as Error | null,
    appendOnlyContractIssues: [] as Array<{ requirement_type: string; requirement_name: string }>,
    appendOnlyContractError: null as Error | null,
    sessionContractIssues: [] as Array<{ requirement_type: string; requirement_name: string }>,
    sessionContractError: null as Error | null,
    sessionLimitContractIssues: [] as Array<{ requirement_type: string; requirement_name: string }>,
    sessionLimitContractError: null as Error | null,
    sloRows: [] as SloRow[],
    sloError: null as Error | null,
    systemRuns: {} as Record<string, string | null>,
    keepaliveDetails: null as Record<string, unknown> | null,
    queueRows: [] as QueueRow[],
    queueError: null as Error | null,
    notificationRows: [] as QueueRow[],
    notificationError: null as Error | null,
    githubCooldown: null as {
      service: "github"
      blocked_until: string
      reason: "retry-after" | "primary-rate-limit" | "secondary-rate-limit"
      source_job_id: string | null
      updated_at: string
    } | null,
  },
}))

vi.mock("@/lib/permissions", () => ({ requirePermission: healthMocks.requirePermission }))
vi.mock("@/lib/db", () => ({
  getActiveGitHubCooldown: vi.fn(async () => {
    const row = healthMocks.state.githubCooldown
    return row
      ? {
          service: "github",
          blockedUntil: row.blocked_until,
          reason: row.reason,
          sourceJobId: row.source_job_id,
          updatedAt: row.updated_at,
        }
      : null
  }),
}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc(name: string) {
      if (name === "get_talon_schema_version") {
        return Promise.resolve({ data: healthMocks.state.schemaVersion, error: healthMocks.state.schemaError })
      }
      if (name === "get_talon_schema_contract_issues") {
        return Promise.resolve({
          data: healthMocks.state.schemaContractIssues,
          error: healthMocks.state.schemaContractError,
        })
      }
      if (name === "get_talon_append_only_contract_issues") {
        return Promise.resolve({
          data: healthMocks.state.appendOnlyContractIssues,
          error: healthMocks.state.appendOnlyContractError,
        })
      }
      if (name === "get_talon_session_contract_issues") {
        return Promise.resolve({
          data: healthMocks.state.sessionContractIssues,
          error: healthMocks.state.sessionContractError,
        })
      }
      if (name === "get_talon_session_limit_contract_issues") {
        return Promise.resolve({
          data: healthMocks.state.sessionLimitContractIssues,
          error: healthMocks.state.sessionLimitContractError,
        })
      }
      throw new Error(`Unexpected health RPC: ${name}`)
    },
    from(table: string) {
      let runKind = ""
      let selection = ""
      const result = () => {
        if (table === "scrapes") {
          if (selection.includes("started_at")) {
            return { data: healthMocks.state.sloRows, error: healthMocks.state.sloError }
          }
          return { data: [], error: healthMocks.state.databaseError }
        }
        if (table === "system_runs") {
          const completedAt = healthMocks.state.systemRuns[runKind]
          return {
            data: completedAt
              ? {
                  completed_at: completedAt,
                  ...(selection.includes("details") ? { details: healthMocks.state.keepaliveDetails } : {}),
                }
              : null,
            error: null,
          }
        }
        if (table === "scrape_jobs") {
          return { data: healthMocks.state.queueRows, error: healthMocks.state.queueError }
        }
        if (table === "service_cooldowns") {
          return { data: healthMocks.state.githubCooldown, error: null }
        }
        if (table === "notification_deliveries") {
          return { data: healthMocks.state.notificationRows, error: healthMocks.state.notificationError }
        }
        throw new Error(`Unexpected health query table: ${table}`)
      }
      const builder = {
        select(columns = "") {
          selection = columns
          return builder
        },
        eq(column: string, value: string) {
          if (column === "kind") runKind = value
          return builder
        },
        in() {
          return builder
        },
        is() {
          return builder
        },
        gte() {
          return builder
        },
        gt() {
          return builder
        },
        order() {
          return builder
        },
        limit() {
          return builder
        },
        maybeSingle() {
          return Promise.resolve(result())
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: ReturnType<typeof result>) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return Promise.resolve(result()).then(onfulfilled, onrejected)
        },
      }
      return builder
    },
  },
}))

import { GET } from "@/app/api/health/route"

const fixedNow = Date.parse("2026-08-13T18:00:00Z")
const recentRun = "2026-08-13T17:59:30.000Z"

function healthRequest(): import("next/server").NextRequest {
  return new Request("https://talon.example/api/health") as import("next/server").NextRequest
}

function configureHealthyEnvironment() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-test-value")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-value")
  vi.stubEnv("TALON_ADMIN_PASSWORD", "admin-password-test-value")
  vi.stubEnv("TALON_SESSION_SECRET", "session-secret-at-least-32-characters")
  vi.stubEnv("CRON_SECRET", "cron-secret-at-least-32-characters-long")
  vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/test")
  vi.stubEnv("GITHUB_TOKEN", "github-test-token")
}

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
    configureHealthyEnvironment()
    healthMocks.requirePermission.mockReturnValue(null)
    healthMocks.state.databaseError = null
    healthMocks.state.schemaVersion = 46
    healthMocks.state.schemaError = null
    healthMocks.state.schemaContractIssues = []
    healthMocks.state.schemaContractError = null
    healthMocks.state.appendOnlyContractIssues = []
    healthMocks.state.appendOnlyContractError = null
    healthMocks.state.sessionContractIssues = []
    healthMocks.state.sessionContractError = null
    healthMocks.state.sessionLimitContractIssues = []
    healthMocks.state.sessionLimitContractError = null
    healthMocks.state.sloRows = [1, 1.5, 2, 2.5, 3].map((minutes) => ({
      status: "completed",
      started_at: "2026-08-13T17:00:00.000Z",
      completed_at: new Date(Date.parse("2026-08-13T17:00:00.000Z") + minutes * 60000).toISOString(),
    }))
    healthMocks.state.sloError = null
    healthMocks.state.queueError = null
    healthMocks.state.queueRows = []
    healthMocks.state.notificationRows = []
    healthMocks.state.notificationError = null
    healthMocks.state.githubCooldown = null
    healthMocks.state.systemRuns = {
      keepalive: recentRun,
      scrape_worker: recentRun,
    }
    healthMocks.state.keepaliveDetails = {
      sloMonitor: {
        state: "healthy",
        fingerprint: "reliability:healthy;latency:healthy",
        lastNotifiedFingerprint: null,
        notification: "unchanged",
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ resources: { core: { remaining: 4500, limit: 5000 } } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("rejects non-admin callers before running infrastructure checks", async () => {
    healthMocks.requirePermission.mockReturnValue(
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    )

    const response = await GET(healthRequest())

    expect(response.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  test("reports a healthy production stack without returning secret values", async () => {
    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe("ok")
    expect(body.checks.github).toEqual({
      status: "ok",
      message: "GitHub token is valid",
      detail: "4500/5000 remaining",
    })
    expect(body.checks.databaseSchema).toEqual({
      status: "ok",
      message: "Database schema matches this application",
      detail: "Current v46; expected v46",
    })
    expect(body.checks.scrapeReliability.detail).toContain("100% success")
    expect(body.checks.scrapeLatency.detail).toContain("p95 3 minutes")
    expect(body.checks.sloAlerting).toEqual({
      status: "ok",
      message: "SLO alert monitor evaluated successfully",
      detail: "Last evaluation: healthy; notification: unchanged",
    })
    expect(body.checks.scrapeQueue.message).toBe("0 queued (0 due), 0 running, 0 failed")
    expect(body.checks.notificationQueue.message).toBe("0 queued (0 due), 0 sending, 0 failed")
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("github-test-token")
    expect(serialized).not.toContain("service-role-test-value")
    expect(serialized).not.toContain("cron-secret-at-least-32-characters-long")
  })

  test("returns 503 when the server GitHub credential is missing", async () => {
    vi.stubEnv("GITHUB_TOKEN", "")

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.status).toBe("error")
    expect(body.checks.github).toEqual({ status: "error", message: "GITHUB_TOKEN is missing" })
    expect(fetch).not.toHaveBeenCalled()
  })

  test("returns 503 when due work has remained queued for more than ten minutes", async () => {
    healthMocks.state.queueRows = [
      {
        status: "queued",
        created_at: "2026-08-13T17:40:00.000Z",
        run_after: "2026-08-13T17:40:00.000Z",
        locked_at: null,
      },
    ]

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.checks.scrapeQueue.status).toBe("error")
    expect(body.checks.scrapeQueue.message).toBe("1 queued (1 due), 0 running, 0 failed")
    expect(body.checks.scrapeQueue.detail).toBe("0 stale running; 0 waiting on GitHub; oldest queued 20 minutes")
  })

  test("returns 503 when a due notification has remained queued for more than ten minutes", async () => {
    healthMocks.state.notificationRows = [
      {
        status: "queued",
        created_at: "2026-08-13T17:40:00.000Z",
        run_after: "2026-08-13T17:40:00.000Z",
        locked_at: null,
      },
    ]

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.checks.notificationQueue.status).toBe("error")
    expect(body.checks.notificationQueue.message).toBe("1 queued (1 due), 0 sending, 0 failed")
    expect(body.checks.notificationQueue.detail).toBe("0 stale sending; oldest due 20 minutes")
  })

  test("returns 503 when production migrations are behind the application", async () => {
    healthMocks.state.schemaVersion = 45

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.checks.databaseSchema).toEqual({
      status: "error",
      message: "Database migrations are behind this application",
      detail: "Current v45; expected v46",
    })
  })

  test("returns 503 when the migration ledger is current but required schema objects are missing", async () => {
    healthMocks.state.schemaContractIssues = [
      { requirement_type: "table", requirement_name: "public.project_contributors_cache" },
      {
        requirement_type: "constraint",
        requirement_name: "public.scrape_jobs.scrape_jobs_team_scrape_fkey",
      },
    ]

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.checks.databaseSchema).toEqual({
      status: "error",
      message: "Database schema contract is incomplete",
      detail: "Current v46; missing table public.project_contributors_cache, constraint public.scrape_jobs.scrape_jobs_team_scrape_fkey",
    })
  })

  test("fails closed when schema object attestation is unavailable", async () => {
    healthMocks.state.schemaContractError = new Error("private catalog detail")

    const response = await GET(healthRequest())
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(503)
    expect(serialized).toContain("Database schema contract could not be verified")
    expect(serialized).not.toContain("private catalog detail")
  })

  test("returns 503 when append-only ledger privileges drift", async () => {
    healthMocks.state.appendOnlyContractIssues = [{
      requirement_type: "table_privilege",
      requirement_name: "service_role DELETE on public.audit_events must be denied",
    }]

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.checks.databaseSchema).toEqual({
      status: "error",
      message: "Database schema contract is incomplete",
      detail: "Current v46; missing table_privilege service_role DELETE on public.audit_events must be denied",
    })
  })

  test("fails closed when append-only attestation is unavailable", async () => {
    healthMocks.state.appendOnlyContractError = new Error("private privilege detail")

    const response = await GET(healthRequest())
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(503)
    expect(serialized).toContain("append-only attestation is unavailable")
    expect(serialized).not.toContain("private privilege detail")
  })

  test("returns 503 when the session registry contract drifts", async () => {
    healthMocks.state.sessionContractIssues = [{
      requirement_type: "table_privilege",
      requirement_name: "anon SELECT on public.auth_sessions must be denied",
    }]

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.checks.databaseSchema.detail).toContain("anon SELECT on public.auth_sessions must be denied")
  })

  test("fails closed when session attestation is unavailable", async () => {
    healthMocks.state.sessionContractError = new Error("private session detail")

    const response = await GET(healthRequest())
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(503)
    expect(serialized).toContain("session attestation is unavailable")
    expect(serialized).not.toContain("private session detail")
  })

  test("returns 503 when the active-session cap contract drifts", async () => {
    healthMocks.state.sessionLimitContractIssues = [{
      requirement_type: "trigger",
      requirement_name: "public.auth_sessions.auth_sessions_enforce_active_limit",
    }]

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.checks.databaseSchema.detail).toContain("auth_sessions_enforce_active_limit")
  })

  test("fails closed when session-limit attestation is unavailable", async () => {
    healthMocks.state.sessionLimitContractError = new Error("private trigger detail")

    const response = await GET(healthRequest())
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(503)
    expect(serialized).toContain("session-limit attestation is unavailable")
    expect(serialized).not.toContain("private trigger detail")
  })

  test("warns when the database is ahead of a rolled-back application", async () => {
    healthMocks.state.schemaVersion = 47

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe("warn")
    expect(body.checks.databaseSchema.detail).toBe("Current v47; application expects v46")
  })

  test("reports a missing schema contract without exposing database error details", async () => {
    healthMocks.state.schemaVersion = null
    healthMocks.state.schemaError = new Error("internal database detail")

    const response = await GET(healthRequest())
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(503)
    expect(serialized).toContain("Database schema version is unavailable")
    expect(serialized).not.toContain("internal database detail")
  })

  test("reports an SLO warning when repository scrape reliability falls below 95%", async () => {
    healthMocks.state.sloRows = [
      ...healthMocks.state.sloRows.slice(0, 4),
      { status: "failed", started_at: "2026-08-13T17:00:00.000Z", completed_at: null },
    ]

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe("warn")
    expect(body.checks.scrapeReliability).toEqual({
      status: "warn",
      message: "Repository scrape reliability is below target",
      detail: "80% success (4 succeeded, 1 failed); Target ≥95% over 7 days",
    })
  })

  test("reports an SLO warning when repository p95 completion exceeds three minutes", async () => {
    healthMocks.state.sloRows = healthMocks.state.sloRows.map((row, index) => ({
      ...row,
      completed_at: new Date(Date.parse(row.started_at) + (index + 4) * 60000).toISOString(),
    }))

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe("warn")
    expect(body.checks.scrapeLatency).toEqual({
      status: "warn",
      message: "Repository scrape latency is above target",
      detail: "p50 6 minutes; p95 8 minutes; Target p95 ≤3 minutes over 7 days",
    })
  })

  test("warns when the most recent keepalive could not deliver an SLO alert", async () => {
    healthMocks.state.keepaliveDetails = {
      sloMonitor: {
        state: "breached",
        notification: "failed",
      },
    }

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe("warn")
    expect(body.checks.sloAlerting).toEqual({
      status: "warn",
      message: "SLO alert monitoring needs attention",
      detail: "Last evaluation: breached; notification: failed",
    })
  })

  test("shows an active GitHub cooldown without making another GitHub request", async () => {
    healthMocks.state.githubCooldown = {
      service: "github",
      blocked_until: "2026-08-13T18:05:00.000Z",
      reason: "primary-rate-limit",
      source_job_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      updated_at: "2026-08-13T18:00:00.000Z",
    }
    healthMocks.state.queueRows = [{
      status: "queued",
      created_at: "2026-08-13T17:40:00.000Z",
      run_after: "2026-08-13T17:40:00.000Z",
      locked_at: null,
    }]

    const response = await GET(healthRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe("warn")
    expect(body.checks.githubCooldown).toEqual({
      status: "warn",
      message: "GitHub API requests are temporarily paused",
      detail: "Automatic resume 2026-08-13T18:05:00.000Z · primary rate limit",
    })
    expect(body.checks.github.message).toBe("GitHub credential check deferred during API cooldown")
    expect(body.checks.scrapeQueue.message).toBe("1 queued (0 due), 0 running, 0 failed")
    expect(body.checks.scrapeQueue.detail).toContain("1 waiting on GitHub")
    expect(fetch).not.toHaveBeenCalled()
  })
})
