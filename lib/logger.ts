const SENSITIVE_KEY = /(authorization|cookie|email|username|login|bio|location|company|target|repo|url|webhook|token|secret|password|key)/i
const SECRET_VALUE = /(bearer|token|secret|password|key)(\s+|[=:]\s*)[^\s,;]+/gi
const URL_VALUE = /https?:\/\/[^\s,;]+/gi
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const MAX_STRING_LENGTH = 500
const MAX_DEPTH = 4

export type LogContext = {
  requestId?: string
  originRequestId?: string | null
  systemRunId?: string
  workerId?: string
  jobId?: string
  scrapeId?: string
  teamId?: string
  details?: Record<string, unknown>
}

function sanitizeString(value: string): string {
  return value
    .replace(SECRET_VALUE, "$1 [redacted]")
    .replace(URL_VALUE, "[redacted-url]")
    .replace(EMAIL_VALUE, "[redacted-email]")
    .slice(0, MAX_STRING_LENGTH)
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return "[truncated]"
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return sanitizeString(value)
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeString(value.message) }
  }
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1))
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeValue(item, depth + 1)])
    )
  }
  return sanitizeString(String(value))
}

export function sanitizeOperationalError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: sanitizeString(error.message) }
  return { name: "Error", message: sanitizeString(typeof error === "string" ? error : "Unknown operational error") }
}

function writeLog(level: "info" | "warn" | "error", event: string, context: LogContext, error?: unknown) {
  const entry = sanitizeValue({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
    ...(error === undefined ? {} : { error: sanitizeOperationalError(error) }),
  })
  const serialized = JSON.stringify(entry)
  if (level === "error") console.error(serialized)
  else if (level === "warn") console.warn(serialized)
  else console.info(serialized)
}

export function logInfo(event: string, context: LogContext = {}) {
  writeLog("info", event, context)
}

export function logWarn(event: string, context: LogContext = {}) {
  writeLog("warn", event, context)
}

export function logError(event: string, error: unknown, context: LogContext = {}) {
  writeLog("error", event, context, error)
}
