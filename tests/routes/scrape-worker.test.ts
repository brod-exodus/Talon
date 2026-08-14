import { beforeEach, describe, expect, test, vi } from "vitest"

const workerMocks = vi.hoisted(() => ({
  recoverStaleScrapeJobs: vi.fn(),
  recordScrapeJobEvent: vi.fn(),
  claimNextScrapeJob: vi.fn(),
  getScrapeJobForWorker: vi.fn(),
  cancelScrapeJob: vi.fn(),
  failScrapeJob: vi.fn(),
  requeueScrapeJob: vi.fn(),
  runScrapeJob: vi.fn(),
  runBoundedJobSteps: vi.fn(),
  ScrapeJobCanceledError: class ScrapeJobCanceledError extends Error {},
  ScrapeJobLeaseLostError: class ScrapeJobLeaseLostError extends Error {
    constructor(status: string) {
      super(`Scrape worker lease was lost; job is now ${status}`)
    }
  },
}))

vi.mock("@/lib/db", () => ({
  recoverStaleScrapeJobs: workerMocks.recoverStaleScrapeJobs,
  recordScrapeJobEvent: workerMocks.recordScrapeJobEvent,
  claimNextScrapeJob: workerMocks.claimNextScrapeJob,
  getScrapeJobForWorker: workerMocks.getScrapeJobForWorker,
  cancelScrapeJob: workerMocks.cancelScrapeJob,
  failScrapeJob: workerMocks.failScrapeJob,
  requeueScrapeJob: workerMocks.requeueScrapeJob,
}))
vi.mock("@/lib/scrape-runner", () => ({
  runScrapeJob: workerMocks.runScrapeJob,
  ScrapeJobCanceledError: workerMocks.ScrapeJobCanceledError,
  ScrapeJobLeaseLostError: workerMocks.ScrapeJobLeaseLostError,
}))
vi.mock("@/lib/worker-budget", () => ({
  runBoundedJobSteps: workerMocks.runBoundedJobSteps,
  WORKER_EXECUTION_BUDGET_MS: 40_000,
  MIN_JOB_START_BUDGET_MS: 10_000,
  MAX_JOB_STEPS_PER_INVOCATION: 20,
  MAX_JOBS_PER_WORKER_INVOCATION: 5,
}))

import { runScrapeWorker } from "@/lib/scrape-worker"
import { ScrapeJobLeaseLostError } from "@/lib/scrape-runner"

const job = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  scrape_id: "scrape-1",
  team_id: "team-1",
  type: "repository" as const,
  target: "octocat/Hello-World",
  min_contributions: 1,
  status: "running" as const,
  attempts: 1,
  max_attempts: 3,
  run_after: "2026-08-13T12:00:00.000Z",
  locked_at: "2026-08-13T12:00:00.000Z",
  locked_by: "worker-original",
  last_error: null,
  state: {},
  cancel_requested: false,
  request_id: null,
  created_at: "2026-08-13T12:00:00.000Z",
  updated_at: "2026-08-13T12:00:00.000Z",
}

describe("lease-safe scrape worker outcomes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workerMocks.recoverStaleScrapeJobs.mockResolvedValue(0)
    workerMocks.recordScrapeJobEvent.mockResolvedValue(undefined)
    workerMocks.claimNextScrapeJob.mockResolvedValueOnce(job).mockResolvedValue(null)
    workerMocks.runBoundedJobSteps.mockResolvedValue({ completed: false, steps: 1, elapsedMs: 10 })
    workerMocks.requeueScrapeJob.mockResolvedValue({ applied: true, status: "queued" })
    workerMocks.failScrapeJob.mockResolvedValue({ applied: true, status: "queued" })
    workerMocks.cancelScrapeJob.mockResolvedValue({})
  })

  test("reports cancellation when a yield loses its lease to cancel", async () => {
    workerMocks.requeueScrapeJob.mockResolvedValue({ applied: false, status: "canceled" })

    const result = await runScrapeWorker({ maxJobs: 1, teamId: "team-1" })

    expect(result.results[0]?.status).toBe("canceled")
    expect(workerMocks.requeueScrapeJob).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }))
  })

  test("does not overwrite cancellation when failure handling loses its lease", async () => {
    workerMocks.runBoundedJobSteps.mockRejectedValue(new Error("GitHub failed"))
    workerMocks.failScrapeJob.mockResolvedValue({ applied: false, status: "canceled" })

    const result = await runScrapeWorker({ maxJobs: 1, teamId: "team-1" })

    expect(result.results[0]?.status).toBe("canceled")
    expect(workerMocks.cancelScrapeJob).not.toHaveBeenCalled()
  })

  test("treats a stale worker lease as skipped without another failure transition", async () => {
    workerMocks.runBoundedJobSteps.mockRejectedValue(new ScrapeJobLeaseLostError("queued"))

    const result = await runScrapeWorker({ maxJobs: 1, teamId: "team-1" })

    expect(result.results[0]?.status).toBe("skipped")
    expect(workerMocks.failScrapeJob).not.toHaveBeenCalled()
    expect(workerMocks.recordScrapeJobEvent).toHaveBeenCalledWith(
      job.id,
      job.scrape_id,
      "worker_lease_lost",
      expect.stringContaining("job is now queued"),
      expect.any(Object)
    )
  })

  test("drains multiple completed jobs through one shared time and step budget", async () => {
    const secondJob = { ...job, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", scrape_id: "scrape-2" }
    let clock = 0
    const budgets: Array<{ budgetMs: number; maxSteps: number }> = []

    workerMocks.claimNextScrapeJob.mockReset()
    workerMocks.claimNextScrapeJob
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce(secondJob)
      .mockResolvedValueOnce(null)
    workerMocks.runBoundedJobSteps.mockImplementation(async ({ budgetMs, maxSteps }) => {
      budgets.push({ budgetMs, maxSteps })
      clock += 2_000
      return { completed: true, steps: 2, elapsedMs: 2_000 }
    })

    const result = await runScrapeWorker({
      maxJobs: 5,
      teamId: "team-1",
      now: () => clock,
    })

    expect(result.results).toHaveLength(2)
    expect(result.stopReason).toBe("queue_empty")
    expect(result.elapsedMs).toBe(4_000)
    expect(budgets).toEqual([
      { budgetMs: 40_000, maxSteps: 20 },
      { budgetMs: 38_000, maxSteps: 18 },
    ])
  })

  test("does not claim another job without safe invocation headroom", async () => {
    let clock = 0
    workerMocks.claimNextScrapeJob.mockReset()
    workerMocks.claimNextScrapeJob.mockResolvedValue(job)
    workerMocks.runBoundedJobSteps.mockImplementation(async () => {
      clock += 31_000
      return { completed: true, steps: 1, elapsedMs: 31_000 }
    })

    const result = await runScrapeWorker({
      maxJobs: 5,
      teamId: "team-1",
      now: () => clock,
    })

    expect(result.results).toHaveLength(1)
    expect(result.stopReason).toBe("time_budget")
    expect(workerMocks.claimNextScrapeJob).toHaveBeenCalledOnce()
  })

  test("requeues a yielded job without claiming past it", async () => {
    workerMocks.claimNextScrapeJob.mockReset()
    workerMocks.claimNextScrapeJob.mockResolvedValue(job)

    const result = await runScrapeWorker({ maxJobs: 5, teamId: "team-1" })

    expect(result.results[0]?.status).toBe("queued")
    expect(result.stopReason).toBe("job_yielded")
    expect(workerMocks.claimNextScrapeJob).toHaveBeenCalledOnce()
  })
})
