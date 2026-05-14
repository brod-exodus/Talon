"use client"

import { useEffect, useState } from "react"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle2, AlertCircle, Key, ExternalLink, Bell, Shield, RefreshCw } from "lucide-react"
import { clearStoredGithubToken, getStoredGithubToken, storeGithubToken } from "@/lib/client-secrets"

type AuditEvent = {
  id: string
  action: string
  outcome: "success" | "failure" | "blocked"
  actor: string
  metadata: Record<string, unknown>
  createdAt: string
}

export default function SettingsPage() {
  const [token, setToken] = useState("")
  const [rememberToken, setRememberToken] = useState(false)
  const [slackWebhook, setSlackWebhook] = useState("")
  const [saved, setSaved] = useState(false)
  const [slackSaved, setSlackSaved] = useState(false)
  const [error, setError] = useState("")
  const [slackError, setSlackError] = useState("")
  const [rateLimit, setRateLimit] = useState<{ limit: number; remaining: number } | null>(null)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [auditEventsLoading, setAuditEventsLoading] = useState(false)
  const [auditEventsError, setAuditEventsError] = useState("")

  useEffect(() => {
    const stored = getStoredGithubToken()
    if (stored.token) {
      setToken(stored.token)
      setRememberToken(stored.persisted)
      void checkRateLimit(stored.token)
    }
    void loadAuditEvents()
  }, [])

  async function loadAuditEvents() {
    setAuditEventsLoading(true)
    setAuditEventsError("")
    try {
      const response = await fetch("/api/audit-events?limit=12")
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to load security events")
      setAuditEvents(Array.isArray(data.events) ? data.events : [])
    } catch (err) {
      setAuditEventsError(err instanceof Error ? err.message : "Failed to load security events")
    } finally {
      setAuditEventsLoading(false)
    }
  }

  async function checkRateLimit(tokenToCheck: string) {
    try {
      const response = await fetch("/api/rate-limit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenToCheck }),
      })
      const data = await response.json()
      if (data.limit) {
        setRateLimit(data)
      }
    } catch (err) {
      console.error("Failed to check rate limit:", err)
    }
  }

  async function handleSave() {
    if (!token.trim()) {
      setError("Please enter a GitHub token")
      return
    }

    if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
      setError("Invalid token format. GitHub tokens start with 'ghp_' or 'github_pat_'")
      return
    }

    try {
      const response = await fetch("/api/rate-limit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError("Invalid token. Please check and try again.")
        return
      }

      storeGithubToken(token, rememberToken)
      setRateLimit(data)
      setSaved(true)
      setError("")

      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError("Failed to verify token. Please try again.")
    }
  }

  function handleClear() {
    clearStoredGithubToken()
    setToken("")
    setRememberToken(false)
    setRateLimit(null)
    setSaved(false)
    setError("")
  }

  async function handleSlackSave() {
    if (!slackWebhook.trim()) {
      setSlackError("Please enter a Slack webhook URL")
      return
    }

    if (!slackWebhook.startsWith("https://hooks.slack.com/")) {
      setSlackError("Invalid webhook URL. It should start with 'https://hooks.slack.com/'")
      return
    }

    try {
      const response = await fetch("/api/slack/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: slackWebhook }),
      })

      if (!response.ok) {
        setSlackError("Failed to send test message. Please check your webhook URL.")
        return
      }

      setSlackSaved(true)
      setSlackError("")

      setTimeout(() => setSlackSaved(false), 3000)
    } catch {
      setSlackError("Failed to verify webhook. Please try again.")
    }
  }

  function handleSlackClear() {
    setSlackWebhook("")
    setSlackSaved(false)
    setSlackError("")
  }

  function formatAuditTime(date: string) {
    return new Date(date).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  }

  function formatAction(action: string) {
    return action
      .split(".")
      .map((part) => part.replace(/_/g, " "))
      .join(" ")
  }

  function formatAuditMetadata(metadata: Record<string, unknown>) {
    const entries = Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined)
    if (!entries.length) return "No details"
    return entries
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
      .join(" | ")
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-12 max-w-4xl">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">Settings</h2>
          <p className="text-muted-foreground">
            Configure Talon&apos;s GitHub access, verify rate limits, and test notification plumbing.
          </p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                GitHub Personal Access Token
              </CardTitle>
              <CardDescription>
                Talon uses your token to start scrapes and unlock GitHub&apos;s authenticated rate limits.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  By default, Talon stores your token only for the current browser tab. Turn on
                  &quot;Remember on this browser&quot; if you want it persisted in local browser storage.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label htmlFor="token">Token</Label>
                <Input
                  id="token"
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="font-mono"
                />
                <p className="text-sm text-muted-foreground">
                  The token is sent to Talon&apos;s server routes when you start a scrape or verify rate limits.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="text-sm font-medium">Remember on this browser</p>
                  <p className="text-xs text-muted-foreground">
                    Stores the token in local browser storage instead of the current tab session.
                  </p>
                </div>
                <Switch checked={rememberToken} onCheckedChange={setRememberToken} />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {saved && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>Token saved successfully.</AlertDescription>
                </Alert>
              )}

              {rateLimit && (
                <div className="p-4 rounded-lg bg-muted">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Rate Limit Status</span>
                    <span className="text-sm text-muted-foreground">
                      {rateLimit.remaining.toLocaleString()} / {rateLimit.limit.toLocaleString()} remaining
                    </span>
                  </div>
                  <div className="w-full bg-background rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${(rateLimit.remaining / rateLimit.limit) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button onClick={handleSave} className="flex-1">
                  Verify & Save Token
                </Button>
                <Button onClick={handleClear} variant="outline">
                  Clear
                </Button>
              </div>

              <div className="pt-6 border-t">
                <h3 className="font-semibold mb-3">How to get a GitHub token:</h3>
                <ol className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">1.</span>
                    <span>
                      Go to{" "}
                      <a
                        href="https://github.com/settings/tokens"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        GitHub Settings → Developer settings → Personal access tokens
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">2.</span>
                    <span>Click &quot;Generate new token (classic)&quot;</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">3.</span>
                    <span>Give it a name like &quot;Talon local&quot;</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">4.</span>
                    <span>
                      Select scopes: <code className="text-xs bg-muted px-1 py-0.5 rounded">public_repo</code>,{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">read:org</code>, and{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">read:user</code>
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">5.</span>
                    <span>Generate and paste the token here</span>
                  </li>
                </ol>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Slack Webhook Test
              </CardTitle>
              <CardDescription>
                Send a test notification to a Slack incoming webhook before wiring it into your deployment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert>
                <Shield className="h-4 w-4" />
                <AlertDescription>
                  This form only sends a one-time test request. Automated watched-repo notifications use the
                  server-side <code className="text-xs bg-muted px-1 py-0.5 rounded">SLACK_WEBHOOK_URL</code>{" "}
                  environment variable.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label htmlFor="slack-webhook">Webhook URL</Label>
                <Input
                  id="slack-webhook"
                  type="password"
                  placeholder="https://hooks.slack.com/services/..."
                  value={slackWebhook}
                  onChange={(e) => setSlackWebhook(e.target.value)}
                  className="font-mono"
                />
                <p className="text-sm text-muted-foreground">
                  Talon does not save this webhook in the browser. Use your deployment environment to persist it.
                </p>
              </div>

              {slackError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{slackError}</AlertDescription>
                </Alert>
              )}

              {slackSaved && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>Slack test message sent successfully.</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3">
                <Button onClick={handleSlackSave} className="flex-1">
                  Send Test Message
                </Button>
                <Button onClick={handleSlackClear} variant="outline">
                  Clear
                </Button>
              </div>

              <div className="pt-6 border-t">
                <h3 className="font-semibold mb-3">How to create a Slack webhook:</h3>
                <ol className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">1.</span>
                    <span>
                      Go to{" "}
                      <a
                        href="https://api.slack.com/messaging/webhooks"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        Slack API: Incoming Webhooks
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">2.</span>
                    <span>Create or open a Slack app and enable Incoming Webhooks</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">3.</span>
                    <span>Add a webhook to the workspace and choose a channel</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">4.</span>
                    <span>Paste the URL above to send a test message</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">5.</span>
                    <span>
                      Store the same value in your deployment as{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">SLACK_WEBHOOK_URL</code> to enable
                      automated alerts
                    </span>
                  </li>
                </ol>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Recent Security Events
                  </CardTitle>
                  <CardDescription>
                    Admin login, scrape, sharing, watched-repo, and outreach changes.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={loadAuditEvents}
                  disabled={auditEventsLoading}
                  className="shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${auditEventsLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {auditEventsError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {auditEventsError}. Apply the latest database migration if this is a fresh deploy.
                  </AlertDescription>
                </Alert>
              )}

              {!auditEventsError && auditEvents.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {auditEventsLoading ? "Loading security events..." : "No security events recorded yet."}
                </p>
              )}

              {auditEvents.map((event) => (
                <div key={event.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium capitalize">{formatAction(event.action)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatAuditMetadata(event.metadata)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {event.outcome}
                      </span>
                      <p className="text-xs text-muted-foreground">{formatAuditTime(event.createdAt)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
