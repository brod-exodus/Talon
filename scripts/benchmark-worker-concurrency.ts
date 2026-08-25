import { runWorkerConcurrencyBenchmark } from "../lib/worker-concurrency-benchmark.ts"

const result = runWorkerConcurrencyBenchmark()
const json = process.argv.includes("--json")

if (json) {
  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), result }, null, 2)}\n`)
} else {
  console.table([
    {
      scenario: "simultaneous claim",
      outcome: `${result.simultaneousClaim.uniqueClaimCount} unique claim, ${result.simultaneousClaim.attempts} attempt`,
    },
    {
      scenario: "workspace fairness",
      outcome: result.fairness.workspaceOrder.join(" → "),
    },
    {
      scenario: "aged background work",
      outcome: `claimed at position ${result.fairness.agedBackgroundPosition}`,
    },
    {
      scenario: "stale lease handoff",
      outcome: result.staleLease.staleCompletionRejected && result.staleLease.replacementCompletionApplied
        ? "stale completion rejected"
        : "failed",
    },
    {
      scenario: "GitHub cooldown",
      outcome: `${result.githubCooldown.claimsWhileBlocked} blocked claims consumed ${result.githubCooldown.attemptsWhileBlocked} attempts`,
    },
  ])
}

if (!result.passed) {
  process.stderr.write("Worker concurrency benchmark failed.\n")
  process.exitCode = 1
}
