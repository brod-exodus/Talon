import { type NextRequest, NextResponse } from "next/server"
import { createSessionToken, setAuthCookie, validateAdminPassword } from "@/lib/auth"
import { readJsonObject } from "@/lib/validation"

export async function POST(request: NextRequest) {
  const body = await readJsonObject(request)
  const password = body?.password

  if (!validateAdminPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 })
  }

  const response = NextResponse.json({ success: true })
  setAuthCookie(response, createSessionToken())
  return response
}
