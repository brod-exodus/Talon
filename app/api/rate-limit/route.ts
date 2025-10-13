import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json()

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 })
    }

    const response = await fetch("https://api.github.com/rate_limit", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    })

    if (!response.ok) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 })
    }

    const data = await response.json()
    const { limit, remaining, reset } = data.rate

    return NextResponse.json({
      limit,
      remaining,
      reset,
    })
  } catch (error) {
    return NextResponse.json({ error: "Failed to check rate limit" }, { status: 500 })
  }
}
