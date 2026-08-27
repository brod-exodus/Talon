"use client"

import { useState } from "react"
import { AlertCircle, Download, RefreshCw, ShieldAlert, Trash2 } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type LifecyclePreview = {
  generatedAt: string
  counts: Record<string, number>
  blockers: Record<string, number>
  hasActiveWork: boolean
}

function message(value: unknown, fallback: string): string {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string"
    ? value.error
    : fallback
}

export function WorkspaceLifecycleControls({ teamSlug }: { teamSlug: string }) {
  const [preview, setPreview] = useState<LifecyclePreview | null>(null)
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState<"preview" | "export" | "delete" | null>(null)
  const [error, setError] = useState("")

  async function loadPreview() {
    setBusy("preview")
    setError("")
    try {
      const response = await fetch("/api/workspace-lifecycle/preview", { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.preview) throw new Error(message(data, "Failed to preview workspace data"))
      setPreview(data.preview as LifecyclePreview)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to preview workspace data")
    } finally {
      setBusy(null)
    }
  }

  async function downloadExport() {
    setBusy("export")
    setError("")
    try {
      const response = await fetch("/api/workspace-lifecycle/export", { method: "POST" })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(message(data, "Failed to export workspace data"))
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `talon-workspace-export-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to export workspace data")
    } finally {
      setBusy(null)
    }
  }

  async function deleteWorkspace() {
    if (confirmation !== teamSlug || preview?.hasActiveWork) return
    setBusy("delete")
    setError("")
    try {
      const response = await fetch("/api/workspace-lifecycle/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || data?.success !== true) throw new Error(message(data, "Failed to delete workspace data"))
      const cleanup = data?.profilePhotoCleanup === "required" ? "&profilePhotoCleanup=required" : ""
      window.location.assign(`/login?workspaceDeleted=1${cleanup}`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete workspace data")
      setBusy(null)
    }
  }

  const rowCount = preview ? Object.values(preview.counts).reduce((total, count) => total + count, 0) : null

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-5 w-5" />
          Workspace Data
        </CardTitle>
        <CardDescription>
          Preview or export this workspace before permanently deleting its Talon data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Deletion cannot be undone. It removes workspace data and profile photos, but not Supabase login identities,
            encrypted backups, or files people already downloaded.
          </AlertDescription>
        </Alert>

        {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void loadPreview()} disabled={busy !== null}>
            <RefreshCw className={`mr-2 h-4 w-4 ${busy === "preview" ? "animate-spin" : ""}`} />
            {preview ? "Refresh preview" : "Preview data"}
          </Button>
          <Button type="button" variant="outline" onClick={() => void downloadExport()} disabled={busy !== null}>
            <Download className="mr-2 h-4 w-4" />
            {busy === "export" ? "Preparing export..." : "Download export"}
          </Button>
        </div>

        {preview && (
          <div className="space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">
              {rowCount?.toLocaleString()} database row{rowCount === 1 ? "" : "s"} are in this workspace.
            </p>
            <p className="text-xs text-muted-foreground">
              Previewed {new Date(preview.generatedAt).toLocaleString()}.
            </p>
            {preview.hasActiveWork && (
              <p className="text-sm text-destructive">
                Deletion is blocked while scrapes or notifications are queued or running.
              </p>
            )}

            <div className="space-y-2 border-t pt-3">
              <Label htmlFor="workspace-delete-confirmation">
                Type <span className="font-mono font-semibold">{teamSlug}</span> to confirm
              </Label>
              <Input
                id="workspace-delete-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="destructive"
                onClick={() => void deleteWorkspace()}
                disabled={busy !== null || preview.hasActiveWork || confirmation !== teamSlug}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {busy === "delete" ? "Deleting workspace..." : "Permanently delete workspace"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
