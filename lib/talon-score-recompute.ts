// Talon Score recompute orchestration, shared by the app (lib/db.ts) and the
// standalone backfill script. Deliberately does NOT import "server-only" or
// lib/supabase so it can run outside Next.js — callers supply their own
// service-role client.

import type { SupabaseClient } from "@supabase/supabase-js"
import { computeTalonScore } from "./talon-score"

type TalonScoreInputRow = {
  contributor_id: string
  total_contributions: number
  completed_scrape_count: number
  best_share: number
  best_share_pool: number
  latest_scrape_completed_at: string | null
}

const TALON_SCORE_BATCH_SIZE = 200

/**
 * Recompute and persist Talon Scores for the given contributors. Inputs come
 * from the get_talon_score_inputs RPC (completed scrapes only); contributors
 * with no completed scrape data still get a contactability-only score so the
 * UI never shows a permanently empty value once a contributor is known.
 */
export async function recomputeTalonScoresWith(
  client: SupabaseClient,
  contributorIds: string[],
  teamId: string
): Promise<void> {
  if (contributorIds.length === 0) return
  const uniqueIds = Array.from(new Set(contributorIds))

  for (let i = 0; i < uniqueIds.length; i += TALON_SCORE_BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + TALON_SCORE_BATCH_SIZE)

    const [contactResult, inputResult] = await Promise.all([
      client
        .from("contributors")
        .select("id, email, twitter, linkedin, website")
        .eq("team_id", teamId)
        .in("id", batch),
      client.rpc("get_talon_score_inputs", { p_contributor_ids: batch }),
    ])
    if (contactResult.error) throw contactResult.error
    if (inputResult.error) throw inputResult.error

    const inputsById = new Map<string, TalonScoreInputRow>()
    for (const row of (inputResult.data ?? []) as TalonScoreInputRow[]) {
      inputsById.set(row.contributor_id, row)
    }

    const scores = (contactResult.data ?? []).map((contributor) => {
      const inputs = inputsById.get(contributor.id)
      const { score, breakdown } = computeTalonScore({
        totalContributions: inputs?.total_contributions ?? 0,
        completedScrapeCount: inputs?.completed_scrape_count ?? 0,
        bestShare: inputs?.best_share ?? 0,
        bestSharePool: inputs?.best_share_pool ?? 0,
        latestScrapeCompletedAt: inputs?.latest_scrape_completed_at ?? null,
        contacts: {
          email: contributor.email,
          twitter: contributor.twitter,
          linkedin: contributor.linkedin,
          website: contributor.website,
        },
      })
      return { id: contributor.id, score, breakdown }
    })
    if (scores.length === 0) continue

    const { error: applyError } = await client.rpc("apply_talon_scores", { p_scores: scores })
    if (applyError) throw applyError
  }
}
