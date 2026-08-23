import { runDefaultCapacityBenchmark } from "../lib/capacity-benchmark.ts"

const results = runDefaultCapacityBenchmark()
const json = process.argv.includes("--json")

if (json) {
  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`)
} else {
  console.table(results.map((result) => ({
    contributors: result.contributors,
    githubRequests: result.githubRequests,
    steps: result.totalSteps,
    invocations: result.workerInvocations,
    estimatedSeconds: Math.round(result.estimatedCompletionMs / 1000),
    budgetSeconds: result.completionBudgetMs === null ? "n/a" : Math.round(result.completionBudgetMs / 1000),
    status: result.withinBudget === false ? "FAIL" : "PASS",
  })))
}

if (results.some((result) => result.withinBudget === false)) process.exitCode = 1
