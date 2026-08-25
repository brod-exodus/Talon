export type BenchmarkJobKind = "interactive" | "background"

type BenchmarkJobStatus = "queued" | "running" | "succeeded"

type BenchmarkJob = {
  id: string
  teamId: string
  kind: BenchmarkJobKind
  createdAtMs: number
  runAfterMs: number
  status: BenchmarkJobStatus
  attempts: number
  lockedAtMs: number | null
  lockedBy: string | null
  lastClaimedAtMs: number | null
}

type Claim = {
  jobId: string
  teamId: string
  workerId: string
  attempt: number
}

export type WorkerConcurrencyBenchmarkResult = {
  simultaneousClaim: {
    workerCount: number
    claimedJobIds: string[]
    uniqueClaimCount: number
    attempts: number
  }
  fairness: {
    claimOrder: string[]
    workspaceOrder: string[]
    agedBackgroundPosition: number
  }
  staleLease: {
    recoveredJobs: number
    staleCompletionRejected: boolean
    replacementCompletionApplied: boolean
  }
  githubCooldown: {
    claimsWhileBlocked: number
    attemptsWhileBlocked: number
    claimAfterCooldown: boolean
  }
  passed: boolean
}

const BACKGROUND_PROMOTION_MS = 15 * 60 * 1000
const STALE_LEASE_MS = 10 * 60 * 1000

class DeterministicQueue {
  private jobs: BenchmarkJob[] = []
  private cooldownUntilMs = 0

  addJob(input: Pick<BenchmarkJob, "id" | "teamId" | "kind" | "createdAtMs">): void {
    this.jobs.push({
      ...input,
      runAfterMs: input.createdAtMs,
      status: "queued",
      attempts: 0,
      lockedAtMs: null,
      lockedBy: null,
      lastClaimedAtMs: null,
    })
  }

  setGitHubCooldown(untilMs: number): void {
    this.cooldownUntilMs = Math.max(this.cooldownUntilMs, untilMs)
  }

  claim(workerId: string, nowMs: number): Claim | null {
    if (this.cooldownUntilMs > nowMs) return null

    const due = this.jobs.filter((job) =>
      job.status === "queued" && job.runAfterMs <= nowMs
    )
    if (!due.length) return null

    const lastTeamClaim = new Map<string, number>()
    for (const job of this.jobs) {
      if (job.lastClaimedAtMs === null) continue
      lastTeamClaim.set(
        job.teamId,
        Math.max(lastTeamClaim.get(job.teamId) ?? Number.NEGATIVE_INFINITY, job.lastClaimedAtMs)
      )
    }

    due.sort((left, right) => {
      const leftPriority = left.kind === "interactive" || left.createdAtMs <= nowMs - BACKGROUND_PROMOTION_MS
      const rightPriority = right.kind === "interactive" || right.createdAtMs <= nowMs - BACKGROUND_PROMOTION_MS
      if (leftPriority !== rightPriority) return leftPriority ? -1 : 1

      const leftTeamClaim = lastTeamClaim.get(left.teamId) ?? Number.NEGATIVE_INFINITY
      const rightTeamClaim = lastTeamClaim.get(right.teamId) ?? Number.NEGATIVE_INFINITY
      if (leftTeamClaim !== rightTeamClaim) return leftTeamClaim - rightTeamClaim

      const leftJobClaim = left.lastClaimedAtMs ?? Number.NEGATIVE_INFINITY
      const rightJobClaim = right.lastClaimedAtMs ?? Number.NEGATIVE_INFINITY
      if (leftJobClaim !== rightJobClaim) return leftJobClaim - rightJobClaim
      if (left.runAfterMs !== right.runAfterMs) return left.runAfterMs - right.runAfterMs
      if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs
      return left.id.localeCompare(right.id)
    })

    // This mutation is the model's atomic claim boundary. A second worker sees
    // the running state and cannot receive the same lease.
    const job = due[0]
    job.status = "running"
    job.attempts += 1
    job.lockedAtMs = nowMs
    job.lockedBy = workerId
    job.lastClaimedAtMs = nowMs
    return { jobId: job.id, teamId: job.teamId, workerId, attempt: job.attempts }
  }

  complete(jobId: string, workerId: string): boolean {
    const job = this.requireJob(jobId)
    if (job.status !== "running" || job.lockedBy !== workerId) return false
    job.status = "succeeded"
    job.lockedAtMs = null
    job.lockedBy = null
    return true
  }

  recoverStale(nowMs: number): number {
    let recovered = 0
    for (const job of this.jobs) {
      if (
        job.status === "running" &&
        job.lockedAtMs !== null &&
        job.lockedAtMs < nowMs - STALE_LEASE_MS
      ) {
        job.status = "queued"
        job.runAfterMs = nowMs
        job.lockedAtMs = null
        job.lockedBy = null
        recovered += 1
      }
    }
    return recovered
  }

  attempts(jobId: string): number {
    return this.requireJob(jobId).attempts
  }

  private requireJob(jobId: string): BenchmarkJob {
    const job = this.jobs.find((candidate) => candidate.id === jobId)
    if (!job) throw new Error(`Unknown benchmark job: ${jobId}`)
    return job
  }
}

export function runWorkerConcurrencyBenchmark(): WorkerConcurrencyBenchmarkResult {
  const simultaneousQueue = new DeterministicQueue()
  simultaneousQueue.addJob({ id: "only-job", teamId: "team-a", kind: "interactive", createdAtMs: 0 })
  const simultaneousClaims = ["worker-1", "worker-2", "worker-3"]
    .map((workerId) => simultaneousQueue.claim(workerId, 0))
    .filter((claim): claim is Claim => claim !== null)
  const simultaneousJobIds = simultaneousClaims.map((claim) => claim.jobId)

  const fairnessQueue = new DeterministicQueue()
  fairnessQueue.addJob({ id: "background-a", teamId: "team-a", kind: "background", createdAtMs: -BACKGROUND_PROMOTION_MS })
  fairnessQueue.addJob({ id: "interactive-a", teamId: "team-a", kind: "interactive", createdAtMs: 0 })
  fairnessQueue.addJob({ id: "interactive-b", teamId: "team-b", kind: "interactive", createdAtMs: 0 })
  fairnessQueue.addJob({ id: "interactive-c", teamId: "team-c", kind: "interactive", createdAtMs: 0 })
  const fairnessClaims: Claim[] = []
  for (let index = 0; index < 4; index += 1) {
    const claim = fairnessQueue.claim(`fair-worker-${index + 1}`, index)
    if (!claim) break
    fairnessClaims.push(claim)
    fairnessQueue.complete(claim.jobId, claim.workerId)
  }
  const fairnessOrder = fairnessClaims.map((claim) => claim.jobId)

  const staleQueue = new DeterministicQueue()
  staleQueue.addJob({ id: "interrupted-job", teamId: "team-a", kind: "interactive", createdAtMs: 0 })
  const staleClaim = staleQueue.claim("stale-worker", 0)
  const recoveredJobs = staleQueue.recoverStale(STALE_LEASE_MS + 1)
  const replacementClaim = staleQueue.claim("replacement-worker", STALE_LEASE_MS + 1)
  const staleCompletionRejected = staleClaim
    ? !staleQueue.complete(staleClaim.jobId, staleClaim.workerId)
    : false
  const replacementCompletionApplied = replacementClaim
    ? staleQueue.complete(replacementClaim.jobId, replacementClaim.workerId)
    : false

  const cooldownQueue = new DeterministicQueue()
  cooldownQueue.addJob({ id: "cooldown-job", teamId: "team-a", kind: "interactive", createdAtMs: 0 })
  cooldownQueue.setGitHubCooldown(60_000)
  const blockedClaims = [
    cooldownQueue.claim("cooldown-worker-1", 0),
    cooldownQueue.claim("cooldown-worker-2", 30_000),
  ].filter((claim) => claim !== null)
  const attemptsWhileBlocked = cooldownQueue.attempts("cooldown-job")
  const claimAfterCooldown = cooldownQueue.claim("cooldown-worker-3", 60_000) !== null

  const agedBackgroundPosition = fairnessOrder.indexOf("background-a") + 1
  const uniqueClaimCount = new Set(simultaneousJobIds).size
  const passed =
    simultaneousClaims.length === 1 &&
    uniqueClaimCount === 1 &&
    simultaneousQueue.attempts("only-job") === 1 &&
    new Set(fairnessClaims.slice(0, 3).map((claim) => claim.teamId)).size === 3 &&
    agedBackgroundPosition > 0 &&
    agedBackgroundPosition <= 4 &&
    recoveredJobs === 1 &&
    staleCompletionRejected &&
    replacementCompletionApplied &&
    blockedClaims.length === 0 &&
    attemptsWhileBlocked === 0 &&
    claimAfterCooldown

  return {
    simultaneousClaim: {
      workerCount: 3,
      claimedJobIds: simultaneousJobIds,
      uniqueClaimCount,
      attempts: simultaneousQueue.attempts("only-job"),
    },
    fairness: {
      claimOrder: fairnessOrder,
      workspaceOrder: fairnessClaims.map((claim) => claim.teamId),
      agedBackgroundPosition,
    },
    staleLease: {
      recoveredJobs,
      staleCompletionRejected,
      replacementCompletionApplied,
    },
    githubCooldown: {
      claimsWhileBlocked: blockedClaims.length,
      attemptsWhileBlocked,
      claimAfterCooldown,
    },
    passed,
  }
}
