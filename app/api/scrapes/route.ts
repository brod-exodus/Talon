import { NextResponse } from "next/server"
import { scrapeStorage } from "@/lib/storage"

export async function GET() {
  const allScrapes = Array.from(scrapeStorage.values()).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())

  const active = allScrapes.filter((s) => s.status === "active")
  const completed = allScrapes.filter((s) => s.status === "completed")

  return NextResponse.json({
    active,
    completed,
  })
}
