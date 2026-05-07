CREATE OR REPLACE FUNCTION get_scrape_contributors_page(
  p_scrape_id TEXT,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  contributor_id UUID,
  github_username TEXT,
  name TEXT,
  avatar_url TEXT,
  bio TEXT,
  location TEXT,
  company TEXT,
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
AS $$
  SELECT
    c.id AS contributor_id,
    c.github_username,
    c.name,
    c.avatar_url,
    c.bio,
    c.location,
    c.company,
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
  FROM scrape_contributors sc
  JOIN contributors c ON c.id = sc.contributor_id
  WHERE sc.scrape_id = p_scrape_id
  ORDER BY sc.contributions DESC, c.github_username ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 500)
  OFFSET GREATEST(p_offset, 0);
$$;
