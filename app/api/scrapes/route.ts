import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getScrapes } from "@/lib/db"

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { active, failed, completed } = await getScrapes()
    return NextResponse.json({ active, failed, completed })
  } catch (error) {
    console.error("[v0] Failed to fetch scrapes:", error)
    return NextResponse.json({ error: "Failed to fetch scrapes", active: [], failed: [], completed: [] }, { status: 500 })
  }
}
