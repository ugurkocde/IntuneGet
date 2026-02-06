-- Add installer_type to RPC function return types
-- The column already exists on curated_apps; this exposes it through the RPC functions

-- Recreate get_popular_curated_apps with installer_type
DROP FUNCTION IF EXISTS get_popular_curated_apps(INTEGER, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION get_popular_curated_apps(
  result_limit INTEGER DEFAULT 50,
  result_offset INTEGER DEFAULT 0,
  category_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id INTEGER,
  winget_id TEXT,
  name TEXT,
  publisher TEXT,
  latest_version TEXT,
  description TEXT,
  homepage TEXT,
  category TEXT,
  tags TEXT[],
  icon_path TEXT,
  popularity_rank INTEGER,
  installer_type TEXT
)
LANGUAGE sql STABLE AS $$
  SELECT
    ca.id,
    ca.winget_id,
    ca.name,
    ca.publisher,
    ca.latest_version,
    ca.description,
    ca.homepage,
    ca.category,
    ca.tags,
    ca.icon_path,
    ca.popularity_rank,
    ca.installer_type
  FROM curated_apps ca
  WHERE
    ca.is_verified = TRUE
    AND (category_filter IS NULL OR ca.category = category_filter)
  ORDER BY ca.popularity_rank ASC NULLS LAST
  LIMIT result_limit
  OFFSET result_offset;
$$;

-- Recreate search_curated_apps with installer_type
DROP FUNCTION IF EXISTS search_curated_apps(TEXT, TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION search_curated_apps(
  search_query TEXT,
  category_filter TEXT DEFAULT NULL,
  result_limit INTEGER DEFAULT 50,
  result_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id INTEGER,
  winget_id TEXT,
  name TEXT,
  publisher TEXT,
  latest_version TEXT,
  description TEXT,
  homepage TEXT,
  category TEXT,
  tags TEXT[],
  icon_path TEXT,
  popularity_rank INTEGER,
  installer_type TEXT,
  rank REAL
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  fts_count INTEGER;
BEGIN
  -- First, try full-text search
  RETURN QUERY
  SELECT
    ca.id,
    ca.winget_id,
    ca.name,
    ca.publisher,
    ca.latest_version,
    ca.description,
    ca.homepage,
    ca.category,
    ca.tags,
    ca.icon_path,
    ca.popularity_rank,
    ca.installer_type,
    ts_rank_cd(ca.fts, websearch_to_tsquery('english', search_query)) AS rank
  FROM curated_apps ca
  WHERE
    ca.fts @@ websearch_to_tsquery('english', search_query)
    AND (category_filter IS NULL OR ca.category = category_filter)
    AND ca.is_verified = TRUE
  ORDER BY rank DESC, ca.popularity_rank ASC NULLS LAST
  LIMIT result_limit
  OFFSET result_offset;

  -- Check if FTS returned any results
  GET DIAGNOSTICS fts_count = ROW_COUNT;

  -- If FTS returned no results, fallback to ILIKE pattern matching
  IF fts_count = 0 THEN
    RETURN QUERY
    SELECT
      ca.id,
      ca.winget_id,
      ca.name,
      ca.publisher,
      ca.latest_version,
      ca.description,
      ca.homepage,
      ca.category,
      ca.tags,
      ca.icon_path,
      ca.popularity_rank,
      ca.installer_type,
      0.0::REAL AS rank
    FROM curated_apps ca
    WHERE
      (
        ca.name ILIKE '%' || search_query || '%'
        OR ca.winget_id ILIKE '%' || search_query || '%'
        OR ca.publisher ILIKE '%' || search_query || '%'
      )
      AND (category_filter IS NULL OR ca.category = category_filter)
      AND ca.is_verified = TRUE
    ORDER BY
      CASE
        WHEN LOWER(ca.name) = LOWER(search_query) THEN 1
        WHEN LOWER(ca.name) LIKE LOWER(search_query) || '%' THEN 2
        WHEN LOWER(ca.winget_id) LIKE '%' || LOWER(search_query) || '%' THEN 3
        ELSE 4
      END,
      ca.popularity_rank ASC NULLS LAST
    LIMIT result_limit
    OFFSET result_offset;
  END IF;
END;
$$;
