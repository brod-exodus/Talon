import { NextResponse, type NextRequest } from "next/server"
import { verifyMiddlewareSessionToken } from "@/lib/middleware-auth"

export const PROTECTED_PATHS = ["/", "/contributors", "/ecosystems", "/pipeline", "/settings", "/watched"]

export async function middleware(request: NextRequest) {
  const secret = process.env.TALON_SESSION_SECRET || process.env.TALON_ADMIN_PASSWORD
  if (!secret) {
    return NextResponse.next()
  }

  const pathname = request.nextUrl.pathname
  const isProtectedPage = PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  if (!isProtectedPage) {
    return NextResponse.next()
  }

  const token = request.cookies.get("talon_session")?.value
  if (await verifyMiddlewareSessionToken(token, secret)) {
    return NextResponse.next()
  }

  const url = request.nextUrl.clone()
  url.pathname = "/login"
  url.searchParams.set("next", `${pathname}${request.nextUrl.search}`)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    "/",
    "/contributors/:path*",
    "/ecosystems/:path*",
    "/pipeline/:path*",
    "/settings/:path*",
    "/watched/:path*",
  ],
}
