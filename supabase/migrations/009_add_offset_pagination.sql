-- Add offset pagination support to curated apps functions

-- Drop and recreate get_popular_curated_apps with offset support
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
  chocolatey_downloads BIGINT
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
    ca.chocolatey_downloads
  FROM curated_apps ca
  WHERE
    ca.is_verified = TRUE
    AND (category_filter IS NULL OR ca.category = category_filter)
  ORDER BY ca.popularity_rank ASC NULLS LAST
  LIMIT result_limit
  OFFSET result_offset;
$$;

-- Also update search_curated_apps for consistency (though not used for infinite scroll)
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
  chocolatey_downloads BIGINT,
  rank REAL
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
    ca.chocolatey_downloads,
    ts_rank_cd(ca.fts, websearch_to_tsquery('english', search_query)) AS rank
  FROM curated_apps ca
  WHERE
    ca.fts @@ websearch_to_tsquery('english', search_query)
    AND (category_filter IS NULL OR ca.category = category_filter)
    AND ca.is_verified = TRUE
  ORDER BY rank DESC, ca.popularity_rank ASC NULLS LAST
  LIMIT result_limit
  OFFSET result_offset;
$$;
