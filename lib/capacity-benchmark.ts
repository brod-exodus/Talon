import {
  MAX_JOB_STEPS_PER_INVOCATION,
  MAX_GITHUB_REQUESTS_PER_WORKER_INVOCATION,
  WORKER_EXECUTION_BUDGET_MS,
} from "./worker-budget.ts"
import { SCRAPE_HYDRATION_BATCH_SIZE } from "./scrape-step.ts"

export const GITHUB_CONTRIBUTOR_PAGE_SIZE = 100
export const DEFAULT_SCHEDULER_INTERVAL_MS = 60_000

export type CapacityScenario = {
  contributors: number
  cachedProfilePercent?: number
  discoveryStepMs?: number
  hydrationStepMs?: number
  schedulerIntervalMs?: number
  firstClaimMs?: number
  executionBudgetMs?: number
  maxStepsPerInvocation?: number
  githubRequestBudget?: number
  completionBudgetMs?: number
}

export type CapacityBenchmarkResult = {
  contributors: number
  cachedProfiles: number
  githubProfileRefreshes: number
  githubRequests: number
  discoveryPages: number
  hydrationBatches: number
  totalSteps: number
  workerInvocations: number
  executionMs: number
  schedulerWaitMs: number
  estimatedCompletionMs: number
  completionBudgetMs: number | null
  withinBudget: boolean | null
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 1) throw new Error(`${name} must be a positive number`)
  return Math.ceil(value)
}

function boundedPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("cachedProfilePercent must be between 0 and 100")
  }
  return value
}

export function runCapacityScenario(scenario: CapacityScenario): CapacityBenchmarkResult {
  const contributors = positiveInteger(scenario.contributors, "contributors")
  const cachedPercent = boundedPercent(scenario.cachedProfilePercent ?? 0)
  const discoveryStepMs = positiveInteger(scenario.discoveryStepMs ?? 300, "discoveryStepMs")
  const hydrationStepMs = positiveInteger(scenario.hydrationStepMs ?? 1_200, "hydrationStepMs")
  const schedulerIntervalMs = positiveInteger(
    scenario.schedulerIntervalMs ?? DEFAULT_SCHEDULER_INTERVAL_MS,
    "schedulerIntervalMs"
  )
  const firstClaimMs = Math.max(0, Math.ceil(scenario.firstClaimMs ?? schedulerIntervalMs))
  const executionBudgetMs = positiveInteger(
    scenario.executionBudgetMs ?? WORKER_EXECUTION_BUDGET_MS,
    "executionBudgetMs"
  )
  const maxSteps = positiveInteger(
    scenario.maxStepsPerInvocation ?? MAX_JOB_STEPS_PER_INVOCATION,
    "maxStepsPerInvocation"
  )
  const completionBudgetMs = scenario.completionBudgetMs === undefined
    ? null
    : positiveInteger(scenario.completionBudgetMs, "completionBudgetMs")
  const githubRequestBudget = positiveInteger(
    scenario.githubRequestBudget ?? MAX_GITHUB_REQUESTS_PER_WORKER_INVOCATION,
    "githubRequestBudget"
  )

  const cachedProfiles = Math.floor(contributors * cachedPercent / 100)
  const githubProfileRefreshes = contributors - cachedProfiles
  const discoveryPages = Math.ceil(contributors / GITHUB_CONTRIBUTOR_PAGE_SIZE)
  const hydrationBatches = Math.ceil(contributors / SCRAPE_HYDRATION_BATCH_SIZE)
  const stepDurations = [
    ...Array.from({ length: discoveryPages }, () => discoveryStepMs),
    ...Array.from({ length: hydrationBatches }, () => hydrationStepMs),
  ]
  const stepCosts = [
    ...Array.from({ length: discoveryPages }, () => 1),
    ...Array.from({ length: hydrationBatches }, () => SCRAPE_HYDRATION_BATCH_SIZE * 2),
  ]

  let workerInvocations = 0
  let invocationMs = 0
  let invocationSteps = 0
  let invocationCost = 0
  for (const [index, stepMs] of stepDurations.entries()) {
    const stepCost = stepCosts[index] ?? 0
    if (invocationSteps > 0 && invocationCost + stepCost > githubRequestBudget) {
      invocationMs = 0
      invocationSteps = 0
      invocationCost = 0
    }
    if (invocationSteps === 0) workerInvocations += 1
    invocationMs += stepMs
    invocationSteps += 1
    invocationCost += stepCost
    if (invocationSteps >= maxSteps || invocationMs >= executionBudgetMs) {
      invocationMs = 0
      invocationSteps = 0
      invocationCost = 0
    }
  }

  const executionMs = discoveryPages * discoveryStepMs + hydrationBatches * hydrationStepMs
  const schedulerWaitMs = firstClaimMs + Math.max(0, workerInvocations - 1) * schedulerIntervalMs
  const estimatedCompletionMs = executionMs + schedulerWaitMs
  return {
    contributors,
    cachedProfiles,
    githubProfileRefreshes,
    githubRequests: discoveryPages + githubProfileRefreshes * 2,
    discoveryPages,
    hydrationBatches,
    totalSteps: stepDurations.length,
    workerInvocations,
    executionMs,
    schedulerWaitMs,
    estimatedCompletionMs,
    completionBudgetMs,
    withinBudget: completionBudgetMs === null ? null : estimatedCompletionMs <= completionBudgetMs,
  }
}

export const DEFAULT_CAPACITY_SCENARIOS: CapacityScenario[] = [
  { contributors: 100, completionBudgetMs: 3 * 60_000 },
  { contributors: 400, completionBudgetMs: 3 * 60_000 },
  { contributors: 1_000, completionBudgetMs: 5 * 60_000 },
  { contributors: 5_000, completionBudgetMs: 25 * 60_000 },
]

export function runDefaultCapacityBenchmark(): CapacityBenchmarkResult[] {
  return DEFAULT_CAPACITY_SCENARIOS.map(runCapacityScenario)
}
