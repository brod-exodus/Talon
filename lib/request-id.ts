export const REQUEST_ID_HEADER = "x-request-id"

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeRequestId(value: string | null | undefined): string | null {
  const requestId = value?.trim()
  return requestId && REQUEST_ID_PATTERN.test(requestId) ? requestId.toLowerCase() : null
}

export function getRequestId(request: Pick<Request, "headers">): string {
  return normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID()
}
