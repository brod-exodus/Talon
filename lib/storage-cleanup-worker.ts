import "server-only"
import { randomUUID } from "node:crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { logError, sanitizeOperationalError } from "@/lib/logger"

type CleanupTask = { id: string; bucket: string; object_paths: unknown }
export type StorageCleanupResult = { taskId: string | null; status: "succeeded" | "queued" | "failed" | "empty" | "skipped"; recoveredStaleTasks: number }

function paths(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((path) => typeof path === "string" && path.length > 0 && path.length <= 512)) {
    throw new Error("Storage cleanup task contains invalid paths")
  }
  return value
}

export async function runStorageCleanupTask(taskId?: string): Promise<StorageCleanupResult> {
  const workerId = `storage-cleanup-${randomUUID()}`
  const { data: recovered, error: recoverError } = await supabaseAdmin.rpc("recover_stale_storage_cleanup_tasks", {
    p_stale_before: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  })
  if (recoverError) throw recoverError
  const { data, error } = await supabaseAdmin.rpc("claim_storage_cleanup_task", { p_worker_id: workerId, p_task_id: taskId ?? null })
  if (error) throw error
  const task = Array.isArray(data) ? data[0] as CleanupTask | undefined : undefined
  if (!task) return { taskId: null, status: "empty", recoveredStaleTasks: Number(recovered ?? 0) }
  try {
    if (task.bucket !== "team-avatars") throw new Error("Unsupported storage cleanup bucket")
    const { error: removeError } = await supabaseAdmin.storage.from(task.bucket).remove(paths(task.object_paths))
    if (removeError) throw removeError
    const { data: applied, error: completeError } = await supabaseAdmin.rpc("complete_storage_cleanup_task", { p_task_id: task.id, p_worker_id: workerId })
    if (completeError) throw completeError
    return { taskId: task.id, status: applied === true ? "succeeded" : "skipped", recoveredStaleTasks: Number(recovered ?? 0) }
  } catch (caught) {
    const { data: nextStatus, error: failError } = await supabaseAdmin.rpc("fail_storage_cleanup_task", {
      p_task_id: task.id, p_worker_id: workerId, p_error: sanitizeOperationalError(caught).message,
    })
    if (failError) throw failError
    logError("storage_cleanup.task_failed", caught, { details: { taskId: task.id } })
    return { taskId: task.id, status: nextStatus === "failed" ? "failed" : nextStatus === "queued" ? "queued" : "skipped", recoveredStaleTasks: Number(recovered ?? 0) }
  }
}

export async function requeueFailedStorageCleanupTasks(): Promise<number> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from("storage_cleanup_tasks")
    .update({
      status: "queued",
      attempts: 0,
      run_after: now,
      completed_at: null,
      updated_at: now,
    })
    .eq("status", "failed")
    .select("id")
  if (error) throw error
  return data?.length ?? 0
}
