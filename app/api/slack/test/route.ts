import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { webhookUrl } = await request.json()

    if (!webhookUrl || typeof webhookUrl !== "string") {
      return NextResponse.json({ error: "Missing webhookUrl in request body" }, { status: 400 })
    }

    if (!webhookUrl.startsWith("https://hooks.slack.com/")) {
      return NextResponse.json({ error: "Invalid Slack webhook URL" }, { status: 400 })
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "✅ GitHub Scraper: Slack notifications are configured and working!",
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
