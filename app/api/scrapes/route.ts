import { NextResponse } from "next/server"
import { getScrapes } from "@/lib/db"

export async function GET() {
  try {
    const { active, completed } = await getScrapes()
    return NextResponse.json({ active, completed })
  } catch (error) {
    console.error("[v0] Failed to fetch scrapes:", error)
    return NextResponse.json({ active: [], completed: [] })
  }
}
