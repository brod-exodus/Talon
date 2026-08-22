import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { logError, logWarn } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { normalizeSlackWebhookUrl, readJsonObject } from "@/lib/validation"

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "admin")
  if (authError) return authError

  try {
    const body = await readJsonObject(request)
    const webhookUrl = normalizeSlackWebhookUrl(body?.webhookUrl)
    if (!body || !webhookUrl) {
      return NextResponse.json({ error: "Invalid Slack webhook URL" }, { status: 400 })
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "✅ Talon: Slack notifications are configured and working!",
      }),
    })

    if (!res.ok) {
      logWarn("slack.test_rejected", { requestId, details: { status: res.status } })
      return NextResponse.json(
        { error: "Slack rejected the webhook request. Please check the URL." },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logError("slack.test_failed", error, { requestId })
    return internalErrorResponse("slack_test_failed", requestId)
  }
}
