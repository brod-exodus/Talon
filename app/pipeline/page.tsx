import { Header } from "@/components/header"
import { PipelineWorkspace } from "@/components/pipeline-workspace"
import { RecruiterWorkflowGuide } from "@/components/recruiter-workflow-guide"

export default function PipelinePage() {
  return (
    <div className="prism-app">
      <Header />

      <main className="prism-main">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="prism-section-title">Pipeline</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Outreach workflow
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
              Work follow-ups, update Project-specific statuses, and keep recruiter outreach moving without crowding discovery.
            </p>
          </div>
        </div>

        <div className="mb-8">
          <RecruiterWorkflowGuide compact />
        </div>

        <PipelineWorkspace />
      </main>
    </div>
  )
}
