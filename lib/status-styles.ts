import type { ProjectOutreachStatus } from "@/lib/validation"

type StatusMeta = {
  label: string
  className: string
}

export const STATUS_BADGE_CLASS = {
  neutral: "border-border bg-muted text-muted-foreground",
  active: "border-primary/30 bg-primary/10 text-primary",
  violet: "border-secondary/25 bg-secondary/10 text-secondary",
  success: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  warning: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
} as const

export const PROJECT_OUTREACH_STATUS_META: Record<ProjectOutreachStatus, StatusMeta> = {
  not_contacted: { label: "Not Contacted", className: STATUS_BADGE_CLASS.neutral },
  contacted: { label: "Contacted", className: STATUS_BADGE_CLASS.active },
  replied: { label: "Replied", className: STATUS_BADGE_CLASS.violet },
  interested: { label: "Interested", className: STATUS_BADGE_CLASS.success },
  interviewing: { label: "Interviewing", className: STATUS_BADGE_CLASS.active },
  rejected: { label: "Rejected", className: STATUS_BADGE_CLASS.destructive },
  archived: { label: "Archived", className: STATUS_BADGE_CLASS.neutral },
}

export const SCRAPE_JOB_STATUS_META: Record<string, StatusMeta> = {
  queued: { label: "Queued", className: STATUS_BADGE_CLASS.warning },
  running: { label: "Running", className: STATUS_BADGE_CLASS.active },
  succeeded: { label: "Succeeded", className: STATUS_BADGE_CLASS.success },
  failed: { label: "Failed", className: STATUS_BADGE_CLASS.destructive },
  canceled: { label: "Canceled", className: STATUS_BADGE_CLASS.neutral },
  retrying: { label: "Retrying", className: STATUS_BADGE_CLASS.warning },
}

export function getProjectOutreachStatusLabel(status: ProjectOutreachStatus) {
  return PROJECT_OUTREACH_STATUS_META[status]?.label ?? PROJECT_OUTREACH_STATUS_META.not_contacted.label
}

export function getProjectOutreachStatusBadgeClass(status: ProjectOutreachStatus) {
  return PROJECT_OUTREACH_STATUS_META[status]?.className ?? STATUS_BADGE_CLASS.neutral
}

export function getScrapeJobStatusBadgeClass(status: string) {
  return SCRAPE_JOB_STATUS_META[status]?.className ?? STATUS_BADGE_CLASS.neutral
}
