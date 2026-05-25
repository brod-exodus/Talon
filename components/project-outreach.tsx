"use client"

import { useEffect, useState } from "react"
import { CalendarClock, Loader2 } from "lucide-react"
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
  if (status === "not_contacted") return "border-slate-200 bg-slate-50 text-slate-600"
  if (status === "contacted") return "border-blue-100 bg-blue-50 text-blue-700"
  if (status === "replied") return "border-violet-100 bg-violet-50 text-violet-700"
  if (status === "interested") return "border-emerald-100 bg-emerald-50 text-emerald-700"
  if (status === "interviewing") return "border-indigo-100 bg-indigo-50 text-indigo-700"
  if (status === "rejected") return "border-rose-100 bg-rose-50 text-rose-700"
  return "border-zinc-200 bg-zinc-50 text-zinc-600"
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
  onSave: (updates: ProjectTrackingUpdate) => Promise<void> | void
}) {
  const [status, setStatus] = useState<ProjectOutreachStatus>(tracking.status)
  const [notes, setNotes] = useState(tracking.notes ?? "")
  const [lastContactedAt, setLastContactedAt] = useState(tracking.lastContactedAt ?? "")
  const [nextFollowUpAt, setNextFollowUpAt] = useState(tracking.nextFollowUpAt ?? "")

  useEffect(() => {
    setStatus(tracking.status)
    setNotes(tracking.notes ?? "")
    setLastContactedAt(tracking.lastContactedAt ?? "")
    setNextFollowUpAt(tracking.nextFollowUpAt ?? "")
  }, [tracking])

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
              className="h-10 w-full cursor-pointer rounded-full border border-white/70 bg-white/80 px-4 text-sm shadow-sm shadow-indigo-500/5 outline-none transition focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {PROJECT_OUTREACH_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <Select value={status} onValueChange={(value) => setStatus(value as ProjectOutreachStatus)} disabled={disabled}>
              <SelectTrigger className="w-full bg-white/80">
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
            className="bg-white/80"
          />
        </div>
        <div className="space-y-2">
          <Label>Next follow-up</Label>
          <Input
            type="date"
            value={nextFollowUpAt}
            onChange={(event) => setNextFollowUpAt(event.target.value)}
            disabled={disabled}
            className="bg-white/80"
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
          className="min-h-24 w-full resize-y rounded-2xl border border-white/70 bg-white/80 px-4 py-3 text-sm shadow-sm shadow-indigo-500/5 outline-none transition focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      <Button
        type="button"
        onClick={() =>
          onSave({
            status,
            notes: notes.trim() ? notes : null,
            lastContactedAt: lastContactedAt || null,
            nextFollowUpAt: nextFollowUpAt || null,
          })
        }
        disabled={disabled || saving}
        className={compact ? "w-full" : ""}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
        Save Outreach
      </Button>
    </div>
  )
}
