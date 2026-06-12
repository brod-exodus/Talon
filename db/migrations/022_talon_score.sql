-- Talon Score: persisted 0-100 contributor ranking.
-- Score math lives in lib/talon-score.ts; this migration adds storage plus
-- set-based helpers for gathering inputs and bulk-applying results.

ALTER TABLE public.contributors
  ADD COLUMN IF NOT EXISTS talon_score SMALLINT
    CHECK (talon_score IS NULL OR (talon_score >= 0 AND talon_score <= 100)),
  ADD COLUMN IF NOT EXISTS talon_score_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS talon_score_computed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contributors_team_talon_score
  ON public.contributors(team_id, talon_score DESC NULLS LAST);

-- Scoring inputs per contributor. Only completed scrapes count: in-progress
-- scrapes persist contributor links incrementally and would skew the numbers.
CREATE OR REPLACE FUNCTION get_talon_score_inputs(p_contributor_ids UUID[])
RETURNS TABLE (
  contributor_id UUID,
  total_contributions BIGINT,
  completed_scrape_count INTEGER,
  best_share DOUBLE PRECISION,
  best_share_pool INTEGER,
  latest_scrape_completed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  WITH links AS (
    SELECT sc.contributor_id, sc.scrape_id, sc.contributions, s.completed_at
    FROM scrape_contributors sc
    JOIN scrapes s ON s.id = sc.scrape_id AND s.status = 'completed'
    WHERE sc.contributor_id = ANY(p_contributor_ids)
  ),
  scrape_stats AS (
    SELECT sc.scrape_id, MAX(sc.contributions) AS max_contributions, COUNT(*) AS pool
    FROM scrape_contributors sc
    WHERE sc.scrape_id IN (SELECT DISTINCT scrape_id FROM links)
    GROUP BY sc.scrape_id
  ),
  shares AS (
    SELECT
      l.contributor_id,
      l.contributions::double precision / NULLIF(ss.max_contributions, 0) AS share,
      ss.pool,
      ROW_NUMBER() OVER (
        PARTITION BY l.contributor_id
        ORDER BY l.contributions::double precision / NULLIF(ss.max_contributions, 0) DESC NULLS LAST
      ) AS rn
    FROM links l
    JOIN scrape_stats ss ON ss.scrape_id = l.scrape_id
  )
  SELECT
    l.contributor_id,
    SUM(l.contributions)::bigint AS total_contributions,
    COUNT(DISTINCT l.scrape_id)::int AS completed_scrape_count,
    COALESCE(s.share, 0) AS best_share,
    COALESCE(s.pool, 0)::int AS best_share_pool,
    MAX(l.completed_at) AS latest_scrape_completed_at
  FROM links l
  LEFT JOIN shares s ON s.contributor_id = l.contributor_id AND s.rn = 1
  GROUP BY l.contributor_id, s.share, s.pool;
$$;

-- Bulk write-back so completing a large scrape issues one statement instead of
-- one UPDATE per contributor.
CREATE OR REPLACE FUNCTION apply_talon_scores(p_scores JSONB)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE public.contributors c
  SET
    talon_score = x.score,
    talon_score_breakdown = x.breakdown,
    talon_score_computed_at = NOW()
  FROM jsonb_to_recordset(p_scores) AS x(id UUID, score SMALLINT, breakdown JSONB)
  WHERE c.id = x.id;
$$;
