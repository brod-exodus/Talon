import { type NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/permissions"

export async function GET(request: NextRequest) {
  const authError = requirePermission(request, "write")
  if (authError) return authError

  try {
    const token = process.env.GITHUB_TOKEN?.trim()
    if (!token) {
      return NextResponse.json(
        { error: "GitHub access is not configured. Set GITHUB_TOKEN in the deployment environment." },
        { status: 503 }
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
  } catch {
    return NextResponse.json({ error: "Failed to check rate limit" }, { status: 500 })
  }
}
