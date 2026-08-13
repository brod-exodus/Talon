export const WORKER_EXECUTION_BUDGET_MS = 40_000
// Twenty 20-profile hydration batches consume at most about 800 GitHub GETs,
// leaving headroom below GitHub's 900-point-per-minute secondary limit.
export const MAX_JOB_STEPS_PER_INVOCATION = 20

type RunBoundedJobStepsOptions<Job> = {
  initialJob: Job
  runStep: (job: Job) => Promise<boolean>
  refreshJob: (job: Job) => Promise<Job>
  budgetMs?: number
  maxSteps?: number
  now?: () => number
}

export async function runBoundedJobSteps<Job>({
  initialJob,
  runStep,
  refreshJob,
  budgetMs = WORKER_EXECUTION_BUDGET_MS,
  maxSteps = MAX_JOB_STEPS_PER_INVOCATION,
  now = Date.now,
}: RunBoundedJobStepsOptions<Job>): Promise<{ completed: boolean; steps: number; elapsedMs: number }> {
  const startedAt = now()
  const safeBudgetMs = Math.max(1, Math.floor(budgetMs))
  const safeMaxSteps = Math.max(1, Math.floor(maxSteps))
  let job = initialJob

  for (let steps = 1; steps <= safeMaxSteps; steps++) {
    const completed = await runStep(job)
    const elapsedMs = Math.max(0, now() - startedAt)
    if (completed) return { completed: true, steps, elapsedMs }
    if (steps >= safeMaxSteps || elapsedMs >= safeBudgetMs) {
      return { completed: false, steps, elapsedMs }
    }
    job = await refreshJob(job)
  }

  return { completed: false, steps: safeMaxSteps, elapsedMs: Math.max(0, now() - startedAt) }
}
