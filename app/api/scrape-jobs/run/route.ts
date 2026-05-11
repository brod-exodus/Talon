import { type NextRequest, NextResponse } from "next/server"
import { hasCronSecret, requireAuth } from "@/lib/auth"
import { runScrapeWorker } from "@/lib/scrape-worker"

const MAX_JOBS_PER_INVOCATION = 1

export async function POST(request: NextRequest) {
  if (!hasCronSecret(request)) {
    const authError = requireAuth(request)
    if (authError) return authError
  }

  const { workerId, results } = await runScrapeWorker(MAX_JOBS_PER_INVOCATION)

  return NextResponse.json({ workerId, processed: results.length, results })
}
