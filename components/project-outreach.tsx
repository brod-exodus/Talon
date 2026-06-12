"use client"

import { useEffect, useRef, useState } from "react"
import { CalendarClock, Check, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type ProjectOutreachStatus =
  | "not_contacted"
  | "contacted"
  | "replied"
  | "interested"
  | "interviewing"
  | "rejected"
  | "archived"

export type ProjectContributorTracking = {
  id: string
  projectId: string
  contributorId: string
  status: ProjectOutreachStatus
  notes: string | null
  lastContactedAt: string | null
  nextFollowUpAt: string | null
  createdAt: string
  updatedAt: string
}

export const PROJECT_OUTREACH_STATUS_OPTIONS: Array<{ value: ProjectOutreachStatus; label: string }> = [
  { value: "not_contacted", label: "Not Contacted" },
  { value: "contacted", label: "Contacted" },
  { value: "replied", label: "Replied" },
  { value: "interested", label: "Interested" },
  { value: "interviewing", label: "Interviewing" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
]

export type ProjectTrackingUpdate = {
  status?: ProjectOutreachStatus
  notes?: string | null
  lastContactedAt?: string | null
  nextFollowUpAt?: string | null
}

export function getProjectOutreachStatusLabel(status: ProjectOutreachStatus) {
  return PROJECT_OUTREACH_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Not Contacted"
}

export function getDefaultProjectTracking(projectId: string, contributorId: string): ProjectContributorTracking {
  const now = new Date(0).toISOString()
  return {
    id: "",
    projectId,
    contributorId,
    status: "not_contacted",
    notes: null,
    lastContactedAt: null,
    nextFollowUpAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function statusBadgeClass(status: ProjectOutreachStatus) {
  if (status === "not_contacted") return "border-border bg-muted text-muted-foreground"
  if (status === "contacted") return "border-primary/25 bg-primary/10 text-primary"
  if (status === "replied") return "border-secondary/25 bg-secondary/10 text-secondary"
  if (status === "interested") return "border-success/25 bg-success/10 text-success"
  if (status === "interviewing") return "border-primary/35 bg-primary/15 text-primary"
  if (status === "rejected") return "border-destructive/30 bg-destructive/10 text-destructive"
  return "border-border bg-muted text-muted-foreground"
}

export function ProjectOutreachBadge({
  status,
  className,
}: {
  status: ProjectOutreachStatus
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn(statusBadgeClass(status), className)}>
      {getProjectOutreachStatusLabel(status)}
    </Badge>
  )
}

export function ProjectOutreachForm({
  tracking,
  disabled = false,
  saving = false,
  compact = false,
  nativeStatus = false,
  onSave,
}: {
  tracking: ProjectContributorTracking
  disabled?: boolean
  saving?: boolean
  compact?: boolean
  nativeStatus?: boolean
  onSave: (updates: ProjectTrackingUpdate) => Promise<unknown> | unknown
}) {
  const [status, setStatus] = useState<ProjectOutreachStatus>(tracking.status)
  const [notes, setNotes] = useState(tracking.notes ?? "")
  const [lastContactedAt, setLastContactedAt] = useState(tracking.lastContactedAt ?? "")
  const [nextFollowUpAt, setNextFollowUpAt] = useState(tracking.nextFollowUpAt ?? "")
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const resetSavedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setStatus(tracking.status)
    setNotes(tracking.notes ?? "")
    setLastContactedAt(tracking.lastContactedAt ?? "")
    setNextFollowUpAt(tracking.nextFollowUpAt ?? "")
  }, [tracking])

  useEffect(() => {
    return () => {
      if (resetSavedTimerRef.current !== null) {
        window.clearTimeout(resetSavedTimerRef.current)
      }
    }
  }, [])

  const isSaving = disabled || saving || saveState === "saving"
  const showSaved = !isSaving && saveState === "saved"

  async function handleSave() {
    if (isSaving) return
    setSaveError(null)
    setSaveState("saving")
    try {
      const result = await onSave({
        status,
        notes: notes.trim() ? notes : null,
        lastContactedAt: lastContactedAt || null,
        nextFollowUpAt: nextFollowUpAt || null,
      })
      if (result === null || result === false) {
        throw new Error("Save failed. Please try again.")
      }
      setSaveState("saved")
      if (resetSavedTimerRef.current !== null) {
        window.clearTimeout(resetSavedTimerRef.current)
      }
      resetSavedTimerRef.current = window.setTimeout(() => {
        setSaveState("idle")
        resetSavedTimerRef.current = null
      }, 1600)
    } catch (error) {
      setSaveState("idle")
      setSaveError(error instanceof Error && error.message ? error.message : "Save failed. Please try again.")
    }
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div className={compact ? "space-y-2" : "grid gap-3 sm:grid-cols-3"}>
        <div className="space-y-2">
          <Label>Status</Label>
          {nativeStatus ? (
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as ProjectOutreachStatus)}
              disabled={disabled}
              className="h-10 w-full cursor-pointer rounded-md border border-input bg-background px-3 text-sm shadow-none outline-none transition focus-visible:border-primary/70 focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {PROJECT_OUTREACH_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <Select value={status} onValueChange={(value) => setStatus(value as ProjectOutreachStatus)} disabled={disabled}>
              <SelectTrigger className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_OUTREACH_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="space-y-2">
          <Label>Last contacted</Label>
          <Input
            type="date"
            value={lastContactedAt}
            onChange={(event) => setLastContactedAt(event.target.value)}
            disabled={disabled}
            className="bg-background"
          />
        </div>
        <div className="space-y-2">
          <Label>Next follow-up</Label>
          <Input
            type="date"
            value={nextFollowUpAt}
            onChange={(event) => setNextFollowUpAt(event.target.value)}
            disabled={disabled}
            className="bg-background"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={disabled}
          maxLength={5000}
          placeholder="Add recruiter notes for this Project..."
          className="min-h-24 w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm shadow-none outline-none transition focus-visible:border-primary/70 focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <Button
        type="button"
        onClick={handleSave}
        disabled={isSaving}
        className={compact ? "w-full" : ""}
      >
        {isSaving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : showSaved ? (
          <>
            <Check className="h-4 w-4" />
            Saved
          </>
        ) : (
          <>
            <CalendarClock className="h-4 w-4" />
            Save Outreach
          </>
        )}
      </Button>
      {saveError && (
        <p className="text-xs font-medium text-destructive">
          {saveError}
        </p>
      )}
    </div>
  )
}
