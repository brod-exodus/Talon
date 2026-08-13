import { type NextRequest, NextResponse } from "next/server"
import { isTrustedRequestOrigin } from "@/lib/request-origin-rules"

export { isTrustedRequestOrigin } from "@/lib/request-origin-rules"

export function requireSameOrigin(request: NextRequest): NextResponse | null {
  return isTrustedRequestOrigin(request)
    ? null
    : NextResponse.json({ error: "Cross-site request rejected" }, { status: 403 })
}
