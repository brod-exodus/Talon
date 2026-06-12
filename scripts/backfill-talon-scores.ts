// One-off backfill: compute Talon Scores for contributors that have none.
// Safe to re-run; only rows with talon_score IS NULL are touched.
//
// Runs outside Next.js, so it builds its own service-role client instead of
// importing lib/supabase (which is guarded by "server-only").
//
// Usage:
//   pnpm backfill:scores
//   # or: pnpm exec tsx --env-file=.env.local scripts/backfill-talon-scores.ts

import { createClient } from "@supabase/supabase-js"
import { recomputeTalonScoresWith } from "../lib/talon-score-recompute"

const PAGE_SIZE = 500

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name}. Run with --env-file=.env.local (or export it).`)
    process.exit(1)
  }
  return value
}

const supabase = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  let totalScored = 0

  // Re-query from the top each pass: scored rows drop out of the filter.
  for (;;) {
    const { data, error } = await supabase
      .from("contributors")
      .select("id, team_id")
      .is("talon_score", null)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE)
    if (error) throw error
    const rows = (data ?? []) as Array<{ id: string; team_id: string }>
    if (rows.length === 0) break

    const idsByTeam = new Map<string, string[]>()
    for (const row of rows) {
      const ids = idsByTeam.get(row.team_id) ?? []
      ids.push(row.id)
      idsByTeam.set(row.team_id, ids)
    }

    for (const [teamId, ids] of idsByTeam) {
      await recomputeTalonScoresWith(supabase, ids, teamId)
      totalScored += ids.length
      console.log(`Scored ${ids.length} contributors for team ${teamId} (total ${totalScored})`)
    }
  }

  console.log(`Backfill complete: ${totalScored} contributors scored.`)
}

main().catch((error) => {
  console.error("Backfill failed:", error)
  process.exit(1)
})
