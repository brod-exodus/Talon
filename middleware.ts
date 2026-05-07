import { NextResponse, type NextRequest } from "next/server"

const PROTECTED_PATHS = ["/", "/ecosystems", "/settings", "/watched"]

export function middleware(request: NextRequest) {
  if (!process.env.TALON_ADMIN_PASSWORD) {
    return NextResponse.next()
  }

  const pathname = request.nextUrl.pathname
  const isProtectedPage = PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  if (!isProtectedPage) {
    return NextResponse.next()
  }

  if (request.cookies.has("talon_session")) {
    return NextResponse.next()
  }

  const url = request.nextUrl.clone()
  url.pathname = "/login"
  url.searchParams.set("next", pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/", "/ecosystems/:path*", "/settings", "/watched"],
}

