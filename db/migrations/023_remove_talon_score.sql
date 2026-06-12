-- Remove Talon Score (reverts migration 022).
-- The V1 ranking shipped without true contribution/code-complexity analysis,
-- so the product is dropping it. Safe to re-run; all statements are idempotent.

DROP FUNCTION IF EXISTS get_talon_score_inputs(UUID[]);
DROP FUNCTION IF EXISTS apply_talon_scores(JSONB);

DROP INDEX IF EXISTS idx_contributors_team_talon_score;

ALTER TABLE public.contributors
  DROP COLUMN IF EXISTS talon_score,
  DROP COLUMN IF EXISTS talon_score_breakdown,
  DROP COLUMN IF EXISTS talon_score_computed_at;
