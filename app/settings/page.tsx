"use client"

import { useEffect, useState } from "react"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle2, AlertCircle, Key, ExternalLink, Bell, Shield, RefreshCw, Download, Users, UserPlus, Trash2, LockKeyhole, ClipboardCheck } from "lucide-react"
import { clearStoredGithubToken, getStoredGithubToken, storeGithubToken } from "@/lib/client-secrets"
import { useAuthMe } from "@/lib/client-permissions"
import { type AuthRole } from "@/lib/auth-token"

type AuditEvent = {
  id: string
  action: string
  outcome: "success" | "failure" | "blocked"
  actor: string
  metadata: Record<string, unknown>
  createdAt: string
}

type TeamMember = {
  id: string
  email: string
  role: AuthRole
  invitedBy: string | null
  createdAt: string
  authStatus: "active" | "unconfirmed" | "missing"
}

const ROLE_OPTIONS: Array<{ value: AuthRole; label: string; description: string }> = [
  { value: "owner", label: "Owner", description: "Full access, including ownership transfer and billing-era controls." },
  { value: "admin", label: "Admin", description: "Can manage settings, teammates, scrapes, and watched repos." },
  { value: "recruiter", label: "Recruiter", description: "Can run scrapes, manage outreach, and use watched repos." },
  { value: "viewer", label: "Viewer", description: "Read-only access for reviewing lists and shared team context." },
]

const AUTH_STATUS_COPY: Record<TeamMember["authStatus"], { label: string; description: string }> = {
  active: {
    label: "Login ready",
    description: "This teammate has a confirmed Supabase Auth account.",
  },
  unconfirmed: {
    label: "Needs password",
    description: "Save this teammate with a temporary password to confirm the login.",
  },
  missing: {
    label: "No login",
    description: "Save this teammate with a temporary password to create the login.",
  },
}

const DEPLOYMENT_CHECKLIST_STORAGE_KEY = "talon:deployment-checklist:v1"

const DEPLOYMENT_CHECKLIST_ITEMS = [
  {
    id: "owner-login",
    label: "Owner/admin login works",
    detail: "Sign in as an owner or admin and confirm Settings loads admin-only sections.",
  },
  {
    id: "recruiter-login",
    label: "Recruiter login works",
    detail: "Sign in as a recruiter and confirm scrapes and watched repos are available.",
  },
  {
    id: "viewer-readonly",
    label: "Viewer remains read-only",
    detail: "Sign in as a viewer and confirm create, edit, scrape, and delete actions are hidden or blocked.",
  },
  {
    id: "successful-scrape",
    label: "Small scrape completes",
    detail: "Run a small repository scrape and confirm it moves from queued/running to completed.",
  },
  {
    id: "failed-retry",
    label: "Failed scrape retry is clear",
    detail: "Force a bad scrape target, click Retry once, and confirm visible retry feedback.",
  },
  {
    id: "watched-repo",
    label: "Watched repo check finishes",
    detail: "Add or use a watched repo, run Check Now, and confirm the last-checked time updates.",
  },
  {
    id: "share-link",
    label: "Share link opens read-only",
    detail: "Create a share link and open it in a private window with no edit actions exposed.",
  },
  {
    id: "slack-test",
    label: "Slack notification path works",
    detail: "Send a Slack test or trigger a watched-repo notification and confirm delivery.",
  },
  {
    id: "security-events",
    label: "Security events are logging",
    detail: "Confirm recent login, password, scrape, or lockout events appear in Settings.",
  },
] as const

export default function SettingsPage() {
  const me = useAuthMe()
  const canWrite = me?.permissions.canWrite ?? false
  const canAdmin = me?.permissions.canAdmin ?? false
  const [token, setToken] = useState("")
  const [rememberToken, setRememberToken] = useState(false)
  const [slackWebhook, setSlackWebhook] = useState("")
  const [saved, setSaved] = useState(false)
  const [slackSaved, setSlackSaved] = useState(false)
  const [error, setError] = useState("")
  const [slackError, setSlackError] = useState("")
  const [rateLimit, setRateLimit] = useState<{ limit: number; remaining: number } | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamMembersLoading, setTeamMembersLoading] = useState(false)
  const [teamMembersError, setTeamMembersError] = useState("")
  const [teamMembersSaved, setTeamMembersSaved] = useState("")
  const [memberEmail, setMemberEmail] = useState("")
  const [memberPassword, setMemberPassword] = useState("")
  const [memberRole, setMemberRole] = useState<AuthRole>("recruiter")
  const [savingMember, setSavingMember] = useState(false)
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [auditEventsLoading, setAuditEventsLoading] = useState(false)
  const [auditEventsError, setAuditEventsError] = useState("")
  const [auditExporting, setAuditExporting] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordChanging, setPasswordChanging] = useState(false)
  const [passwordError, setPasswordError] = useState("")
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [deploymentChecklist, setDeploymentChecklist] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const stored = getStoredGithubToken()
    if (stored.token) {
      setToken(stored.token)
      setRememberToken(stored.persisted)
      if (canWrite) void checkRateLimit(stored.token)
    }
    if (canAdmin) {
      void loadTeamMembers()
      void loadAuditEvents()
    }
  }, [canAdmin, canWrite])

  useEffect(() => {
    if (!canAdmin) return
    try {
      const stored = window.localStorage.getItem(DEPLOYMENT_CHECKLIST_STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored) as Record<string, unknown>
      setDeploymentChecklist(
        Object.fromEntries(
          DEPLOYMENT_CHECKLIST_ITEMS.map((item) => [item.id, parsed[item.id] === true])
        )
      )
    } catch {
      setDeploymentChecklist({})
    }
  }, [canAdmin])

  async function loadTeamMembers() {
    setTeamMembersLoading(true)
    setTeamMembersError("")
    try {
      const response = await fetch("/api/team-members", { cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to load team members")
      setTeamMembers(Array.isArray(data.members) ? data.members : [])
    } catch (err) {
      setTeamMembersError(err instanceof Error ? err.message : "Failed to load team members")
    } finally {
      setTeamMembersLoading(false)
    }
  }

  async function loadAuditEvents() {
    setAuditEventsLoading(true)
    setAuditEventsError("")
    try {
      const response = await fetch("/api/audit-events?limit=100")
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
    if (!canWrite) {
      setError("Your current role cannot save GitHub tokens.")
      return
    }

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
    if (!canWrite) return
    clearStoredGithubToken()
    setToken("")
    setRememberToken(false)
    setRateLimit(null)
    setSaved(false)
    setError("")
  }

  function updateDeploymentChecklist(itemId: string, checked: boolean) {
    setDeploymentChecklist((prev) => {
      const next = { ...prev, [itemId]: checked }
      window.localStorage.setItem(DEPLOYMENT_CHECKLIST_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  function resetDeploymentChecklist() {
    window.localStorage.removeItem(DEPLOYMENT_CHECKLIST_STORAGE_KEY)
    setDeploymentChecklist({})
  }

  async function handlePasswordChange() {
    if (me?.actor !== "user") return

    setPasswordError("")
    setPasswordSaved(false)

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.")
      return
    }

    if (newPassword.trim().length < 8) {
      setPasswordError("New password must be at least 8 characters.")
      return
    }

    setPasswordChanging(true)
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Failed to update password")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setPasswordSaved(true)
      setTimeout(() => setPasswordSaved(false), 3000)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to update password")
    } finally {
      setPasswordChanging(false)
    }
  }

  async function handleSlackSave() {
    if (!canAdmin) {
      setSlackError("Only admins can send Slack webhook tests.")
      return
    }

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
    if (!canAdmin) return
    setSlackWebhook("")
    setSlackSaved(false)
    setSlackError("")
  }

  async function handleAddMember() {
    if (!canAdmin) return
    setSavingMember(true)
    setTeamMembersError("")
    setTeamMembersSaved("")
    try {
      const response = await fetch("/api/team-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: memberEmail, password: memberPassword, role: memberRole }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to save team member")
      const nextMember = data.member as TeamMember
      setTeamMembers((prev) => {
        const existing = prev.findIndex((member) => member.id === nextMember.id)
        if (existing === -1) return [...prev, nextMember]
        const copy = [...prev]
        copy[existing] = nextMember
        return copy
      })
      setMemberEmail("")
      setMemberPassword("")
      setMemberRole("recruiter")
      setTeamMembersSaved(
        data.authUserCreated
          ? "Team member login created and ready."
          : data.authUserUpdated
            ? "Team member login updated and ready."
            : "Team member role saved."
      )
      setTimeout(() => setTeamMembersSaved(""), 3000)
    } catch (err) {
      setTeamMembersError(err instanceof Error ? err.message : "Failed to save team member")
    } finally {
      setSavingMember(false)
    }
  }

  async function handleRoleChange(member: TeamMember, role: AuthRole) {
    if (!canAdmin || member.role === role) return
    const roleLabel = ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role
    const currentRoleLabel = ROLE_OPTIONS.find((option) => option.value === member.role)?.label ?? member.role
    const requiresConfirmation = role === "owner" || role === "admin" || member.role === "owner"
    if (
      requiresConfirmation &&
      !window.confirm(`Change ${member.email} from ${currentRoleLabel} to ${roleLabel}?`)
    ) {
      return
    }

    setTeamMembersError("")
    setTeamMembersSaved("")
    setUpdatingMemberId(member.id)
    try {
      const response = await fetch(`/api/team-members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to update role")
      const updated = data.member as TeamMember
      setTeamMembers((prev) => prev.map((item) => item.id === updated.id ? updated : item))
      setTeamMembersSaved("Role updated.")
      setTimeout(() => setTeamMembersSaved(""), 3000)
    } catch (err) {
      setTeamMembersError(err instanceof Error ? err.message : "Failed to update role")
    } finally {
      setUpdatingMemberId(null)
    }
  }

  async function handleRemoveMember(member: TeamMember) {
    if (!canAdmin) return
    if (!window.confirm(`Remove ${member.email} from this Talon team?`)) return
    setTeamMembersError("")
    setTeamMembersSaved("")
    setRemovingMemberId(member.id)
    try {
      const response = await fetch(`/api/team-members/${member.id}`, { method: "DELETE" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Failed to remove team member")
      setTeamMembers((prev) => prev.filter((item) => item.id !== member.id))
      setTeamMembersSaved("Team member removed.")
      setTimeout(() => setTeamMembersSaved(""), 3000)
    } catch (err) {
      setTeamMembersError(err instanceof Error ? err.message : "Failed to remove team member")
    } finally {
      setRemovingMemberId(null)
    }
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

  async function exportAuditEventsCsv() {
    if (!canAdmin) return
    setAuditExporting(true)
    try {
      const response = await fetch("/api/audit-events?limit=100&format=csv")
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || "Failed to export security events")
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `talon-audit-events-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setAuditEventsError(err instanceof Error ? err.message : "Failed to export security events")
    } finally {
      setAuditExporting(false)
    }
  }

  const last24Hours = Date.now() - 24 * 60 * 60 * 1000
  const recentEvents = auditEvents.filter((event) => new Date(event.createdAt).getTime() >= last24Hours)
  const recentLockouts = recentEvents.filter(
    (event) => event.action === "auth.login" && event.outcome === "blocked"
  ).length
  const recentScrapeFailures = recentEvents.filter(
    (event) => event.action === "scrape.failure" && event.outcome === "failure"
  ).length
  const ownerCount = teamMembers.filter((member) => member.role === "owner").length
  const selectedRoleDescription = ROLE_OPTIONS.find((role) => role.value === memberRole)?.description
  const completedDeploymentChecks = DEPLOYMENT_CHECKLIST_ITEMS.filter((item) => deploymentChecklist[item.id]).length

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
          {!canWrite && (
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertDescription>
                Viewer access is read-only. GitHub token, Slack, and security-event settings require a recruiter or admin role.
              </AlertDescription>
            </Alert>
          )}

          {me?.actor === "user" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LockKeyhole className="w-5 h-5" />
                  Account Security
                </CardTitle>
                <CardDescription>
                  Change the password for {me.email}. This does not affect break-glass admin access.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="current-password">Current password</Label>
                    <Input
                      id="current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                {passwordError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{passwordError}</AlertDescription>
                  </Alert>
                )}

                {passwordSaved && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>Password updated.</AlertDescription>
                  </Alert>
                )}

                <Button
                  type="button"
                  onClick={handlePasswordChange}
                  disabled={passwordChanging || !currentPassword || !newPassword || !confirmPassword}
                >
                  {passwordChanging ? "Updating..." : "Update Password"}
                </Button>
              </CardContent>
            </Card>
          )}

          {canAdmin && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ClipboardCheck className="w-5 h-5" />
                      Deployment Checklist
                    </CardTitle>
                    <CardDescription>
                      Admin-only smoke checks for validating a fresh production deploy.
                    </CardDescription>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {completedDeploymentChecks}/{DEPLOYMENT_CHECKLIST_ITEMS.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  {DEPLOYMENT_CHECKLIST_ITEMS.map((item) => (
                    <label
                      key={item.id}
                      htmlFor={`deployment-check-${item.id}`}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
                    >
                      <input
                        id={`deployment-check-${item.id}`}
                        type="checkbox"
                        checked={deploymentChecklist[item.id] ?? false}
                        onChange={(event) => updateDeploymentChecklist(item.id, event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-border accent-primary"
                      />
                      <span className="min-w-0 space-y-1">
                        <span className="block text-sm font-medium text-foreground">{item.label}</span>
                        <span className="block text-xs text-muted-foreground">{item.detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    Progress is saved in this browser only, so each admin can run their own checklist during deploy verification.
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={resetDeploymentChecklist}>
                    Reset
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

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
                  disabled={!canWrite}
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
                <Switch checked={rememberToken} onCheckedChange={setRememberToken} disabled={!canWrite} />
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
                <Button onClick={handleSave} className="flex-1" disabled={!canWrite}>
                  Verify & Save Token
                </Button>
                <Button onClick={handleClear} variant="outline" disabled={!canWrite}>
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

          {canAdmin && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5" />
                  Operational Signals
                </CardTitle>
                <CardDescription>
                  Alert-style summary over the last 24 hours from security events.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">Admin login lockouts</p>
                  <p className="text-xs text-muted-foreground">
                    {recentLockouts === 0
                      ? "No lockouts in the last 24 hours."
                      : `${recentLockouts} lockout event(s) in the last 24 hours.`}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">Scrape processing failures</p>
                  <p className="text-xs text-muted-foreground">
                    {recentScrapeFailures === 0
                      ? "No scrape failures in the last 24 hours."
                      : `${recentScrapeFailures} scrape failure event(s) in the last 24 hours.`}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {canAdmin && (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Team Access
                    </CardTitle>
                    <CardDescription>
                      Add teammates and manage Talon roles without editing SQL.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadTeamMembers}
                    disabled={teamMembersLoading}
                    className="shrink-0"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${teamMembersLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <Alert>
                  <Shield className="h-4 w-4" />
                  <AlertDescription>
                    Add the teammate&apos;s email, choose a role, and set a temporary password. If the login already exists,
                    entering a password resets it and confirms the account. Share temporary passwords out of band until
                    password-reset emails are configured.
                  </AlertDescription>
                </Alert>

                <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_9rem_auto]">
                  <div className="space-y-2">
                    <Label htmlFor="team-member-email">Email</Label>
                    <Input
                      id="team-member-email"
                      type="email"
                      value={memberEmail}
                      onChange={(event) => setMemberEmail(event.target.value)}
                      placeholder="recruiter@example.com"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="team-member-password">Temporary password</Label>
                    <Input
                      id="team-member-password"
                      type="password"
                      value={memberPassword}
                      onChange={(event) => setMemberPassword(event.target.value)}
                      placeholder="8+ characters"
                      autoComplete="new-password"
                    />
                    <p className="text-xs text-muted-foreground">
                      Required for new logins. Optional when only changing a role.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="team-member-role">Role</Label>
                    <Select value={memberRole} onValueChange={(value) => setMemberRole(value as AuthRole)}>
                      <SelectTrigger id="team-member-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_OPTIONS.map((role) => (
                          <SelectItem key={role.value} value={role.value}>
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedRoleDescription && (
                      <p className="text-xs text-muted-foreground">{selectedRoleDescription}</p>
                    )}
                  </div>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      onClick={handleAddMember}
                      disabled={savingMember || !memberEmail.trim()}
                      className="w-full gap-2"
                    >
                      <UserPlus className="w-4 h-4" />
                      {savingMember ? "Saving..." : "Add"}
                    </Button>
                  </div>
                </div>

                {teamMembersError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{teamMembersError}</AlertDescription>
                  </Alert>
                )}

                {teamMembersSaved && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription>{teamMembersSaved}</AlertDescription>
                  </Alert>
                )}

                <div className="rounded-lg border border-border">
                  {teamMembersLoading && teamMembers.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">Loading team members...</p>
                  ) : teamMembers.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">No team members configured yet.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {teamMembers.map((member) => {
                        const isSoleOwner = member.role === "owner" && ownerCount <= 1
                        const roleDescription = ROLE_OPTIONS.find((role) => role.value === member.role)?.description
                        return (
                          <div key={member.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 space-y-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="truncate text-sm font-medium text-foreground">{member.email}</p>
                                <Badge
                                  variant={member.authStatus === "active" ? "secondary" : "outline"}
                                  className="shrink-0 text-xs"
                                  title={AUTH_STATUS_COPY[member.authStatus].description}
                                >
                                  {AUTH_STATUS_COPY[member.authStatus].label}
                                </Badge>
                                {isSoleOwner && (
                                  <Badge variant="outline" className="shrink-0 text-xs">
                                    Protected
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Added {new Date(member.createdAt).toLocaleDateString()}
                              </p>
                              {roleDescription && (
                                <p className="text-xs text-muted-foreground">{roleDescription}</p>
                              )}
                              {member.authStatus !== "active" && (
                                <p className="text-xs text-amber-600 dark:text-amber-400">
                                  {AUTH_STATUS_COPY[member.authStatus].description}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Select
                                value={member.role}
                                disabled={isSoleOwner || updatingMemberId === member.id}
                                onValueChange={(value) => handleRoleChange(member, value as AuthRole)}
                              >
                                <SelectTrigger className="h-8 w-32">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLE_OPTIONS.map((role) => (
                                    <SelectItem key={role.value} value={role.value}>
                                      {role.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                disabled={isSoleOwner || removingMemberId === member.id}
                                onClick={() => handleRemoveMember(member)}
                                aria-label={`Remove ${member.email}`}
                                title={isSoleOwner ? "At least one owner must remain" : `Remove ${member.email}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                            {isSoleOwner && (
                              <p className="text-xs text-muted-foreground sm:hidden">
                                Add another owner before changing or removing this one.
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {canAdmin && (
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
                <Button onClick={handleSlackSave} className="flex-1" disabled={!canAdmin}>
                  Send Test Message
                </Button>
                <Button onClick={handleSlackClear} variant="outline" disabled={!canAdmin}>
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
          )}

          {canAdmin && (
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
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={exportAuditEventsCsv}
                    disabled={auditExporting}
                    className="shrink-0"
                  >
                    <Download className={`w-4 h-4 mr-2 ${auditExporting ? "animate-pulse" : ""}`} />
                    Export CSV
                  </Button>
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

              {auditEvents.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Showing {auditEvents.length} events. Scroll inside this panel to review older activity.
                </p>
              )}

              {auditEvents.length > 0 && (
                <div className="max-h-[420px] space-y-3 overflow-y-auto pr-2">
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
                </div>
              )}
            </CardContent>
          </Card>
          )}
        </div>
      </main>
    </div>
  )
}
