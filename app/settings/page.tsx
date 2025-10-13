"use client"

import { useState, useEffect } from "react"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle2, AlertCircle, Key, ExternalLink, Bell } from "lucide-react"

export default function SettingsPage() {
  const [token, setToken] = useState("")
  const [slackWebhook, setSlackWebhook] = useState("")
  const [saved, setSaved] = useState(false)
  const [slackSaved, setSlackSaved] = useState(false)
  const [error, setError] = useState("")
  const [slackError, setSlackError] = useState("")
  const [rateLimit, setRateLimit] = useState<{ limit: number; remaining: number } | null>(null)

  useEffect(() => {
    const savedToken = localStorage.getItem("github_token")
    if (savedToken) {
      setToken(savedToken)
      checkRateLimit(savedToken)
    }

    const savedSlackWebhook = localStorage.getItem("slack_webhook_url")
    if (savedSlackWebhook) {
      setSlackWebhook(savedSlackWebhook)
    }
  }, [])

  const checkRateLimit = async (tokenToCheck: string) => {
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

  const handleSave = async () => {
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

      localStorage.setItem("github_token", token)
      setRateLimit(data)
      setSaved(true)
      setError("")

      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError("Failed to verify token. Please try again.")
    }
  }

  const handleClear = () => {
    localStorage.removeItem("github_token")
    setToken("")
    setRateLimit(null)
    setSaved(false)
    setError("")
  }

  const handleSlackSave = async () => {
    if (!slackWebhook.trim()) {
      setSlackError("Please enter a Slack webhook URL")
      return
    }

    if (!slackWebhook.startsWith("https://hooks.slack.com/")) {
      setSlackError("Invalid webhook URL. It should start with 'https://hooks.slack.com/'")
      return
    }

    try {
      // Test the webhook
      const response = await fetch("/api/slack/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: slackWebhook }),
      })

      if (!response.ok) {
        setSlackError("Failed to send test message. Please check your webhook URL.")
        return
      }

      localStorage.setItem("slack_webhook_url", slackWebhook)
      setSlackSaved(true)
      setSlackError("")

      setTimeout(() => setSlackSaved(false), 3000)
    } catch (err) {
      setSlackError("Failed to verify webhook. Please try again.")
    }
  }

  const handleSlackClear = () => {
    localStorage.removeItem("slack_webhook_url")
    setSlackWebhook("")
    setSlackSaved(false)
    setSlackError("")
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-12 max-w-4xl">
        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-2">Settings</h2>
          <p className="text-muted-foreground">Configure your GitHub API access and notifications</p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                GitHub Personal Access Token
              </CardTitle>
              <CardDescription>Required for scraping repositories. Provides 5,000 requests per hour.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                  Your token is stored locally in your browser and never sent to our servers.
                </p>
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
                  <AlertDescription>Token saved successfully!</AlertDescription>
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
                  Save Token
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
                    <span>Click "Generate new token (classic)"</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">3.</span>
                    <span>Give it a name like "Groq Talent Intelligence"</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">4.</span>
                    <span>
                      Select scopes: <code className="text-xs bg-muted px-1 py-0.5 rounded">public_repo</code> and{" "}
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">read:user</code>
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">5.</span>
                    <span>Generate and copy the token</span>
                  </li>
                </ol>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="w-5 h-5" />
                Slack Notifications
              </CardTitle>
              <CardDescription>
                Get notified in Slack when new contributors are detected in tracked organizations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                  Your webhook URL is stored locally and used to send notifications.
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
                  <AlertDescription>Slack webhook saved and tested successfully!</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3">
                <Button onClick={handleSlackSave} className="flex-1">
                  Save & Test Webhook
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
                    <span>Click "Create your Slack app" and choose "From scratch"</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">3.</span>
                    <span>Enable "Incoming Webhooks" and click "Add New Webhook to Workspace"</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">4.</span>
                    <span>Select the channel where you want notifications</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-semibold text-foreground">5.</span>
                    <span>Copy the webhook URL and paste it above</span>
                  </li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
