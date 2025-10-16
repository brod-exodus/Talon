import { NextResponse } from "next/server"
import { getAllScrapes } from "@/lib/storage-local"

export async function GET() {
  try {
    const { active, completed } = await getAllScrapes()

    return NextResponse.json({
      active: active.map((s) => ({
        id: s.id,
        target: s.target,
        type: s.type,
        progress: s.progress,
        current: s.current,
        total: s.total,
        currentUser: s.currentUser,
        startedAt: s.startedAt,
      })),
      completed: completed.map((s) => ({
        id: s.id,
        target: s.target,
        type: s.type,
        role: s.role,
        completedAt: s.completedAt || s.startedAt,
        contributors: s.contributors,
      })),
    })
  } catch (error) {
    console.error("[v0] Failed to fetch scrapes:", error)
    return NextResponse.json({ error: "Failed to fetch scrapes", active: [], completed: [] }, { status: 500 })
  }
}
