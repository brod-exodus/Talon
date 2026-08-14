-- Include the contributor's self-reported GitHub location in the lightweight
-- completed-scrape response without restoring the larger profile payload.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 40 AND name = 'atomic_team_member_management'
  ) THEN
    RAISE EXCEPTION 'Talon migration 040 must be applied before migration 041';
  END IF;
END $$;

DROP FUNCTION public.get_contactable_scrape_contributors_page(TEXT, INTEGER, INTEGER);

CREATE FUNCTION public.get_contactable_scrape_contributors_page(
  p_scrape_id TEXT,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  contributor_id UUID,
  github_username TEXT,
  name TEXT,
  avatar_url TEXT,
  location TEXT,
  email TEXT,
  twitter TEXT,
  linkedin TEXT,
  website TEXT,
  contacted BOOLEAN,
  contacted_date DATE,
  outreach_notes TEXT,
  status TEXT,
  contributions INTEGER,
  contributor_total BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    c.id AS contributor_id,
    c.github_username,
    c.name,
    c.avatar_url,
    c.location,
    c.email,
    c.twitter,
    c.linkedin,
    c.website,
    c.contacted,
    c.contacted_date,
    c.outreach_notes,
    c.status,
    sc.contributions,
    COUNT(*) OVER () AS contributor_total
  FROM public.scrape_contributors AS sc
  JOIN public.contributors AS c ON c.id = sc.contributor_id
  WHERE sc.scrape_id = p_scrape_id
    AND (
      NULLIF(BTRIM(c.email), '') IS NOT NULL
      OR NULLIF(BTRIM(c.twitter), '') IS NOT NULL
      OR NULLIF(BTRIM(c.linkedin), '') IS NOT NULL
      OR NULLIF(BTRIM(c.website), '') IS NOT NULL
    )
  ORDER BY sc.contributions DESC, c.github_username ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 500)
  OFFSET GREATEST(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.get_contactable_scrape_contributors_page(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contactable_scrape_contributors_page(TEXT, INTEGER, INTEGER) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (41, 'contactable_contributor_locations')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
