import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { getActiveGitHubCooldown } from "@/lib/db"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const token = process.env.GITHUB_TOKEN?.trim()
    if (!token) {
      return NextResponse.json(
        { error: "GitHub access is not configured. Set GITHUB_TOKEN in the deployment environment." },
        { status: 503 }
      )
    }

    const cooldown = await getActiveGitHubCooldown()
    if (cooldown) {
      return NextResponse.json(
        {
          code: "github_cooldown",
          error: `GitHub checks are paused until ${new Date(cooldown.blockedUntil).toISOString()}.`,
          retryAt: cooldown.blockedUntil,
        },
        { status: 429 }
      )
    }

    const response = await fetch("https://api.github.com/rate_limit", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })

    if (!response.ok) {
      return NextResponse.json({ error: "The configured GitHub token is invalid." }, { status: 502 })
    }

    const data = await response.json()
    const { limit, remaining, reset } = data.rate

    return NextResponse.json({
      limit,
      remaining,
      reset,
    })
  } catch (error) {
    logError("github.rate_limit_check_failed", error, { requestId })
    return internalErrorResponse("github_rate_limit_check_failed", requestId)
  }
}
