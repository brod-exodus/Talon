// One-off backfill: compute Talon Scores for contributors that have none.
// Safe to re-run; only rows with talon_score IS NULL are touched.
//
// Usage (the react-server condition neutralizes `import "server-only"` in
// lib/supabase.ts; --env-file supplies the Supabase env vars):
//   node --experimental-strip-types --conditions react-server --env-file=.env.local scripts/backfill-talon-scores.ts

import { supabaseAdmin } from "../lib/supabase.ts"
import { recomputeTalonScores } from "../lib/db.ts"

const PAGE_SIZE = 500

async function main() {
  let totalScored = 0

  // Re-query from the top each pass: scored rows drop out of the filter.
  for (;;) {
    const { data, error } = await supabaseAdmin
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
      await recomputeTalonScores(ids, teamId)
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
