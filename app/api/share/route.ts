import { type NextRequest, NextResponse } from "next/server"
import { createSharedScrape } from "@/lib/db"

function randomToken(length = 10): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let token = ""
  for (let i = 0; i < length; i++) {
    token += chars[Math.floor(Math.random() * chars.length)]
  }
  return token
}

export async function POST(request: NextRequest) {
  try {
    const { scrapeId } = await request.json()
    if (!scrapeId) {
      return NextResponse.json({ error: "Missing scrapeId" }, { status: 400 })
    }

    const token = randomToken(10)
    await createSharedScrape(scrapeId, token)

    return NextResponse.json({ token })
  } catch (error) {
    console.error("[share] Failed to create share:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create share" },
      { status: 500 }
    )
  }
}
