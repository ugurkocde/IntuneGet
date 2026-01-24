-- Winget Package Cache Table
-- This table caches all winget packages for fast full-text search
-- Updated daily via cron job to stay in sync with winget.run

CREATE TABLE IF NOT EXISTS winget_packages (
  id TEXT PRIMARY KEY,                    -- Package ID e.g., "Microsoft.PowerToys"
  name TEXT NOT NULL,
  publisher TEXT NOT NULL,
  latest_version TEXT NOT NULL,
  description TEXT,
  homepage TEXT,
  license TEXT,
  versions TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  popularity_score INTEGER DEFAULT 0,
  icon_url TEXT,

  -- Full-text search vector (auto-generated)
  fts TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(id, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(publisher, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  raw_data JSONB
);

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_winget_packages_fts ON winget_packages USING GIN (fts);
CREATE INDEX IF NOT EXISTS idx_winget_packages_popularity ON winget_packages (popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_winget_packages_name ON winget_packages (name);
CREATE INDEX IF NOT EXISTS idx_winget_packages_publisher ON winget_packages (publisher);

-- Sync status tracking (singleton table)
CREATE TABLE IF NOT EXISTS winget_sync_status (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_sync_started_at TIMESTAMPTZ,
  last_sync_completed_at TIMESTAMPTZ,
  last_sync_status TEXT,
  packages_synced INTEGER DEFAULT 0,
  error_message TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial sync status row
INSERT INTO winget_sync_status (id, last_sync_status)
VALUES (1, 'never_synced')
ON CONFLICT (id) DO NOTHING;

-- RLS: Public read, service role write
ALTER TABLE winget_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE winget_sync_status ENABLE ROW LEVEL SECURITY;

-- Anyone can read packages (public catalog)
CREATE POLICY "Public read winget_packages" ON winget_packages
  FOR SELECT USING (true);

-- Only service role can modify packages
CREATE POLICY "Service write winget_packages" ON winget_packages
  FOR ALL USING (auth.role() = 'service_role');

-- Anyone can read sync status
CREATE POLICY "Public read winget_sync_status" ON winget_sync_status
  FOR SELECT USING (true);

-- Only service role can modify sync status
CREATE POLICY "Service write winget_sync_status" ON winget_sync_status
  FOR ALL USING (auth.role() = 'service_role');

-- Search function with ranking
-- Uses PostgreSQL full-text search with weighted ranking
CREATE OR REPLACE FUNCTION search_winget_packages(
  search_query TEXT,
  result_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  publisher TEXT,
  latest_version TEXT,
  description TEXT,
  homepage TEXT,
  tags TEXT[],
  versions TEXT[],
  rank REAL
)
LANGUAGE sql STABLE AS $$
  SELECT
    wp.id,
    wp.name,
    wp.publisher,
    wp.latest_version,
    wp.description,
    wp.homepage,
    wp.tags,
    wp.versions,
    ts_rank_cd(wp.fts, websearch_to_tsquery('english', search_query)) AS rank
  FROM winget_packages wp
  WHERE wp.fts @@ websearch_to_tsquery('english', search_query)
  ORDER BY rank DESC, wp.popularity_score DESC
  LIMIT result_limit;
$$;

-- Simple prefix search for autocomplete (faster for partial matches)
CREATE OR REPLACE FUNCTION search_winget_packages_prefix(
  search_query TEXT,
  result_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  publisher TEXT,
  latest_version TEXT,
  description TEXT,
  homepage TEXT,
  tags TEXT[],
  versions TEXT[],
  rank REAL
)
LANGUAGE sql STABLE AS $$
  SELECT
    wp.id,
    wp.name,
    wp.publisher,
    wp.latest_version,
    wp.description,
    wp.homepage,
    wp.tags,
    wp.versions,
    CASE
      WHEN wp.id ILIKE search_query || '%' THEN 1.0
      WHEN wp.name ILIKE search_query || '%' THEN 0.9
      WHEN wp.id ILIKE '%' || search_query || '%' THEN 0.5
      WHEN wp.name ILIKE '%' || search_query || '%' THEN 0.4
      ELSE 0.1
    END::REAL AS rank
  FROM winget_packages wp
  WHERE
    wp.id ILIKE '%' || search_query || '%'
    OR wp.name ILIKE '%' || search_query || '%'
    OR wp.publisher ILIKE '%' || search_query || '%'
  ORDER BY rank DESC, wp.popularity_score DESC
  LIMIT result_limit;
$$;

-- Popular packages function
CREATE OR REPLACE FUNCTION get_popular_winget_packages(result_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  publisher TEXT,
  latest_version TEXT,
  description TEXT,
  homepage TEXT,
  tags TEXT[]
)
LANGUAGE sql STABLE AS $$
  SELECT
    wp.id,
    wp.name,
    wp.publisher,
    wp.latest_version,
    wp.description,
    wp.homepage,
    wp.tags
  FROM winget_packages wp
  ORDER BY wp.popularity_score DESC, wp.name
  LIMIT result_limit;
$$;

-- Get sync status
CREATE OR REPLACE FUNCTION get_winget_sync_status()
RETURNS TABLE (
  last_sync_started_at TIMESTAMPTZ,
  last_sync_completed_at TIMESTAMPTZ,
  last_sync_status TEXT,
  packages_synced INTEGER,
  error_message TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT
    last_sync_started_at,
    last_sync_completed_at,
    last_sync_status,
    packages_synced,
    error_message
  FROM winget_sync_status
  WHERE id = 1;
$$;
