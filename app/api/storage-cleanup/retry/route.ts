import { after, type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { recordAuditEvent } from "@/lib/audit"
import { logError, logInfo } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { requeueFailedStorageCleanupTasks, runStorageCleanupTask } from "@/lib/storage-cleanup-worker"

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "admin")
  if (authError) return authError

  try {
    const requeued = await requeueFailedStorageCleanupTasks()
    await recordAuditEvent({
      request,
      action: "storage_cleanup.retry",
      outcome: "success",
      metadata: { requeued },
    })
    logInfo("storage_cleanup.retry_queued", { requestId, details: { requeued } })

    if (requeued > 0) {
      after(async () => {
        try {
          await runStorageCleanupTask()
        } catch (error) {
          logError("storage_cleanup.retry_dispatch_failed", error, { requestId })
        }
      })
    }

    return NextResponse.json(
      { status: requeued > 0 ? "queued" : "unchanged", requeued },
      { status: requeued > 0 ? 202 : 200 }
    )
  } catch (error) {
    await recordAuditEvent({
      request,
      action: "storage_cleanup.retry",
      outcome: "failure",
    })
    logError("storage_cleanup.retry_failed", error, { requestId })
    return internalErrorResponse("storage_cleanup_retry_failed", requestId)
  }
}
