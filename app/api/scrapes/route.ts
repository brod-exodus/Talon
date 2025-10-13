import { NextResponse } from "next/server"
import { scrapeStorage } from "@/lib/storage"

export async function GET() {
  try {
    const scrapes = Array.from(scrapeStorage.values())

    const active = scrapes
      .filter((s) => s.status === "active")
      .map((s) => ({
        id: s.id,
        target: s.target,
        type: s.type,
        progress: s.progress,
        current: s.current,
        total: s.total,
        currentUser: s.currentUser,
        startedAt: s.startedAt,
      }))

    const completed = scrapes
      .filter((s) => s.status === "completed")
      .map((s) => ({
        id: s.id,
        target: s.target,
        type: s.type,
        completedAt: s.completedAt || s.startedAt,
        contributors: s.contributors,
      }))

    return NextResponse.json({
      active,
      completed,
    })
  } catch (error) {
    console.error("[v0] Failed to fetch scrapes:", error)
    return NextResponse.json({ active: [], completed: [] })
  }
}
