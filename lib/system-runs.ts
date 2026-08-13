import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { sanitizeOperationalError } from "@/lib/logger"

export type SystemRunKind = "keepalive" | "scrape_worker" | "watched_repos"

export async function startSystemRun(
  kind: SystemRunKind,
  details: Record<string, unknown> = {},
  requestId?: string
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("system_runs")
    .insert({ kind, status: "running", details, request_id: requestId ?? null })
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
      error: error === undefined ? null : sanitizeOperationalError(error).message,
    })
    .eq("id", id)
  if (updateError) throw updateError
}
