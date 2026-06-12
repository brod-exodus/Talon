"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { TalonScoreBreakdown } from "@/lib/talon-score"
import { cn } from "@/lib/utils"

const BREAKDOWN_ROWS = [
  { key: "depth", label: "Depth", max: 30 },
  { key: "breadth", label: "Breadth", max: 20 },
  { key: "influence", label: "Influence", max: 20 },
  { key: "recency", label: "Recency", max: 15 },
  { key: "contactability", label: "Contactability", max: 15 },
] as const

function scoreToneClass(score: number): string {
  if (score >= 70) return "border-primary/40 bg-primary/15 text-primary"
  if (score >= 40) return "border-primary/25 bg-primary/10 text-primary/80"
  return "border-border bg-muted text-muted-foreground"
}

export function TalonScoreTooltipBody({ breakdown }: { breakdown: TalonScoreBreakdown }) {
  return (
    <div className="max-w-64 space-y-2 py-1">
      <p className="text-xs leading-relaxed">{breakdown.explanation}</p>
      <div className="space-y-1">
        {BREAKDOWN_ROWS.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 font-mono text-[10px]">
            <span>{row.label}</span>
            <span>
              {breakdown[row.key]}/{row.max}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TalonScoreBadge({
  score,
  breakdown,
  className,
}: {
  score: number | null | undefined
  breakdown?: TalonScoreBreakdown | null
  className?: string
}) {
  if (score == null) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground",
          className
        )}
        title="Talon Score not computed yet"
      >
        —
      </span>
    )
  }

  const badge = (
    <span
      className={cn(
        "inline-flex cursor-default items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold",
        scoreToneClass(score),
        className
      )}
      aria-label={`Talon Score ${score} out of 100`}
    >
      {score}
    </span>
  )

  if (!breakdown) return badge

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>
        <TalonScoreTooltipBody breakdown={breakdown} />
      </TooltipContent>
    </Tooltip>
  )
}
