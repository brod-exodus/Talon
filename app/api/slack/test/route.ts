import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { normalizeSlackWebhookUrl, readJsonObject } from "@/lib/validation"

export async function POST(request: NextRequest) {
  const authError = requireAuth(request)
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
      const body = await res.text()
      console.error("[slack/test] Slack returned non-OK:", res.status, body)
      return NextResponse.json(
        { error: "Slack rejected the webhook request. Please check the URL." },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[slack/test] Error:", error)
    return NextResponse.json({ error: "Failed to send test message" }, { status: 500 })
  }
}
