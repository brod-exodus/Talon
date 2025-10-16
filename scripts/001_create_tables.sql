-- Create scrapes table
CREATE TABLE IF NOT EXISTS scrapes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('org', 'repo')),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  current INTEGER DEFAULT 0,
  total INTEGER DEFAULT 100,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  role TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create contributors table
CREATE TABLE IF NOT EXISTS contributors (
  id TEXT PRIMARY KEY,
  scrape_id TEXT NOT NULL REFERENCES scrapes(id) ON DELETE CASCADE,
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  html_url TEXT,
  contributions INTEGER DEFAULT 0,
  contacted BOOLEAN DEFAULT FALSE,
  contacted_date TEXT,
  contacted_method TEXT,
  contacted_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create roles table for custom role tabs
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_scrapes_status ON scrapes(status);
CREATE INDEX IF NOT EXISTS idx_scrapes_role ON scrapes(role);
CREATE INDEX IF NOT EXISTS idx_contributors_scrape_id ON contributors(scrape_id);
CREATE INDEX IF NOT EXISTS idx_contributors_contacted ON contributors(contacted);

-- Disable RLS since this is a single-user tool
ALTER TABLE scrapes DISABLE ROW LEVEL SECURITY;
ALTER TABLE contributors DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
