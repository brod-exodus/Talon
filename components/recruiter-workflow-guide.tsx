import Link from "next/link"
import { ArrowRight, FolderKanban, Search, Send } from "lucide-react"

const STEPS = [
  {
    label: "1. Discover",
    description: "Run a repository or organization scrape and review public contribution evidence.",
    href: "/",
    action: "Open dashboard",
    icon: Search,
  },
  {
    label: "2. Organize",
    description: "Add promising contributors to a Project or list for a specific role or search.",
    href: "/ecosystems",
    action: "Open Projects",
    icon: FolderKanban,
  },
  {
    label: "3. Outreach",
    description: "Track Project-specific status and follow-up dates in the Pipeline.",
    href: "/pipeline",
    action: "Open Pipeline",
    icon: Send,
  },
] as const

export function RecruiterWorkflowGuide({ compact = false }: { compact?: boolean }) {
  return (
    <section aria-labelledby="recruiter-workflow-title" className="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div>
        <p id="recruiter-workflow-title" className="text-sm font-semibold text-foreground">
          Recruiter workflow
        </p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          Contributor notes and reminders follow the person everywhere. Outreach status, outreach notes, and follow-ups belong to one Project.
        </p>
      </div>
      <ol className={`mt-4 grid gap-3 ${compact ? "lg:grid-cols-3" : "md:grid-cols-3"}`}>
        {STEPS.map((step) => {
          const Icon = step.icon
          return (
            <li key={step.label} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                <p className="text-sm font-semibold text-foreground">{step.label}</p>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.description}</p>
              <Link href={step.href} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                {step.action}
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
