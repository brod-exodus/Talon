import { NextResponse, type NextRequest } from "next/server"
import { verifyMiddlewareSessionToken } from "@/lib/middleware-auth"
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/request-id"

export const PROTECTED_PATHS = ["/", "/contributors", "/ecosystems", "/pipeline", "/settings", "/watched"]

function nextResponseWithRequestId(request: NextRequest, requestId: string) {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(REQUEST_ID_HEADER, requestId)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

export async function middleware(request: NextRequest) {
  const requestId = getRequestId(request)
  const secret = process.env.TALON_SESSION_SECRET || process.env.TALON_ADMIN_PASSWORD
  if (!secret) {
    return nextResponseWithRequestId(request, requestId)
  }

  const pathname = request.nextUrl.pathname
  const isProtectedPage = PROTECTED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  if (!isProtectedPage) {
    return nextResponseWithRequestId(request, requestId)
  }

  const token = request.cookies.get("talon_session")?.value
  if (await verifyMiddlewareSessionToken(token, secret)) {
    return nextResponseWithRequestId(request, requestId)
  }

  const url = request.nextUrl.clone()
  url.pathname = "/login"
  url.searchParams.set("next", `${pathname}${request.nextUrl.search}`)
  const response = NextResponse.redirect(url)
  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

export const config = {
  matcher: [
    "/",
    "/contributors/:path*",
    "/ecosystems/:path*",
    "/pipeline/:path*",
    "/settings/:path*",
    "/watched/:path*",
    "/api/:path*",
  ],
}
