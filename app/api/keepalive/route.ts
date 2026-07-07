import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

function hasCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  return request.headers.get("authorization") === `Bearer ${secret}`
}

function createKeepaliveClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export async function GET(request: NextRequest) {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const supabase = createKeepaliveClient()
    const { error } = await supabase.from("team_memberships").select("id").limit(1)

    if (error) {
      console.error("[keepalive] Supabase query failed:", error)
      return NextResponse.json({ error: "Supabase keepalive query failed" }, { status: 500 })
    }

    return NextResponse.json({ success: true, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error("[keepalive] request failed:", error)
    return NextResponse.json({ error: "Supabase keepalive failed" }, { status: 500 })
  }
}
