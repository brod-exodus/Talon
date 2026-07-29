import "server-only"
import { supabaseAdmin } from "@/lib/supabase"

export type SystemRunKind = "keepalive" | "scrape_worker" | "watched_repos"

function sanitizedError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown operational error"
  return message.replace(/(bearer|token|secret|key)\s+[^\s,;]+/gi, "$1 [redacted]").slice(0, 500)
}

export async function startSystemRun(kind: SystemRunKind, details: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("system_runs")
    .insert({ kind, status: "running", details })
    .select("id")
    .single()
  if (error) throw error
  return data.id
}

export async function finishSystemRun(
  id: string,
  status: "success" | "failure",
  details: Record<string, unknown> = {},
  error?: unknown
): Promise<void> {
  const { error: updateError } = await supabaseAdmin
    .from("system_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      details,
      error: error === undefined ? null : sanitizedError(error),
    })
    .eq("id", id)
  if (updateError) throw updateError
}
