export const WORKER_EXECUTION_BUDGET_MS = 40_000
// Do not claim another job unless one worst-case GitHub request still fits
// comfortably inside the 60-second serverless invocation limit.
export const MIN_JOB_START_BUDGET_MS = 10_000
// Request weighting, rather than this defensive ceiling, normally bounds work.
export const MAX_JOB_STEPS_PER_INVOCATION = 100
// Keep headroom below GitHub's 900-point-per-minute secondary limit.
export const MAX_GITHUB_REQUESTS_PER_WORKER_INVOCATION = 850
export const MAX_JOBS_PER_WORKER_INVOCATION = 5

type RunBoundedJobStepsOptions<Job> = {
  initialJob: Job
  runStep: (job: Job) => Promise<boolean>
  refreshJob: (job: Job) => Promise<Job>
  budgetMs?: number
  maxSteps?: number
  now?: () => number
  getStepCost?: (job: Job) => number
  costBudget?: number
}

export async function runBoundedJobSteps<Job>({
  initialJob,
  runStep,
  refreshJob,
  budgetMs = WORKER_EXECUTION_BUDGET_MS,
  maxSteps = MAX_JOB_STEPS_PER_INVOCATION,
  now = Date.now,
  getStepCost = () => 0,
  costBudget = Number.MAX_SAFE_INTEGER,
}: RunBoundedJobStepsOptions<Job>): Promise<{
  completed: boolean
  steps: number
  elapsedMs: number
  cost: number
  limit?: "cost" | "steps" | "time"
}> {
  const startedAt = now()
  const safeBudgetMs = Math.max(1, Math.floor(budgetMs))
  const safeMaxSteps = Math.max(1, Math.floor(maxSteps))
  const safeCostBudget = Math.max(0, Math.floor(costBudget))
  let job = initialJob
  let cost = 0

  for (let steps = 1; steps <= safeMaxSteps; steps++) {
    const stepCost = Math.max(0, Math.ceil(getStepCost(job)))
    if (cost + stepCost > safeCostBudget) {
      return {
        completed: false,
        steps: steps - 1,
        elapsedMs: Math.max(0, now() - startedAt),
        cost,
        limit: "cost",
      }
    }
    const completed = await runStep(job)
    cost += stepCost
    const elapsedMs = Math.max(0, now() - startedAt)
    if (completed) return { completed: true, steps, elapsedMs, cost }
    if (steps >= safeMaxSteps || elapsedMs >= safeBudgetMs) {
      return {
        completed: false,
        steps,
        elapsedMs,
        cost,
        limit: steps >= safeMaxSteps ? "steps" : "time",
      }
    }
    job = await refreshJob(job)
  }

  return {
    completed: false,
    steps: safeMaxSteps,
    elapsedMs: Math.max(0, now() - startedAt),
    cost,
    limit: "steps",
  }
}
