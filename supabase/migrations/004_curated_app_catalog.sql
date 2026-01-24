-- Curated App Catalog Migration
-- Replaces WinGet.Run API with a self-managed system:
-- - 1000 popular Windows apps (ranked by Chocolatey download stats)
-- - GitHub Action-based manifest syncing and installation scanning
-- - Icon storage in Git repository
-- - Installation changelog tracking (files, registry, shortcuts)

-- ============================================================================
-- Table: curated_apps
-- Core app metadata with popularity scoring
-- ============================================================================
CREATE TABLE IF NOT EXISTS curated_apps (
  id SERIAL PRIMARY KEY,
  winget_id TEXT UNIQUE NOT NULL,           -- e.g., "Google.Chrome"
  chocolatey_id TEXT,                        -- e.g., "googlechrome"
  name TEXT NOT NULL,
  publisher TEXT NOT NULL,
  latest_version TEXT,
  description TEXT,
  homepage TEXT,
  license TEXT,

  -- Ranking and popularity
  chocolatey_downloads BIGINT DEFAULT 0,     -- Raw download count from Chocolatey
  popularity_rank INTEGER,                    -- 1-1000 ranking

  -- Categorization
  category TEXT,                             -- e.g., "browser", "developer-tools"
  subcategory TEXT,
  tags TEXT[] DEFAULT '{}',

  -- Icon info (stored in git repo)
  icon_path TEXT,                            -- e.g., "/icons/Google.Chrome/"
  has_icon BOOLEAN DEFAULT FALSE,

  -- Curation metadata
  curation_notes TEXT,
  manually_mapped BOOLEAN DEFAULT FALSE,     -- True if chocolatey->winget mapping was manual
  is_verified BOOLEAN DEFAULT FALSE,         -- True if manifest verified to exist

  -- Full-text search vector
  fts TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(winget_id, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(publisher, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) STORED,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for curated_apps
CREATE INDEX IF NOT EXISTS idx_curated_apps_winget_id ON curated_apps (winget_id);
CREATE INDEX IF NOT EXISTS idx_curated_apps_chocolatey_id ON curated_apps (chocolatey_id);
CREATE INDEX IF NOT EXISTS idx_curated_apps_popularity ON curated_apps (popularity_rank ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_curated_apps_category ON curated_apps (category);
CREATE INDEX IF NOT EXISTS idx_curated_apps_fts ON curated_apps USING GIN (fts);

-- ============================================================================
-- Table: version_history
-- Per-version installer info (URLs, hashes, release notes)
-- ============================================================================
CREATE TABLE IF NOT EXISTS version_history (
  id SERIAL PRIMARY KEY,
  winget_id TEXT NOT NULL,
  version TEXT NOT NULL,

  -- Installer metadata from YAML manifest
  installer_url TEXT,
  installer_sha256 TEXT,
  installer_type TEXT,                       -- msi, exe, msix, etc.
  installer_scope TEXT,                      -- machine, user
  silent_args TEXT,

  -- Architecture-specific installers (JSONB array)
  installers JSONB DEFAULT '[]',             -- Full installer array from manifest

  -- Additional manifest data
  minimum_os_version TEXT,
  platform TEXT[],
  upgrade_behavior TEXT,

  -- Release tracking
  release_date TIMESTAMPTZ,
  release_notes TEXT,
  changes_from_previous TEXT,

  -- Manifest source
  manifest_yaml TEXT,                        -- Raw YAML content
  manifest_fetched_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(winget_id, version)
);

-- Indexes for version_history
CREATE INDEX IF NOT EXISTS idx_version_history_winget_id ON version_history (winget_id);
CREATE INDEX IF NOT EXISTS idx_version_history_version ON version_history (winget_id, version);
CREATE INDEX IF NOT EXISTS idx_version_history_release_date ON version_history (release_date DESC NULLS LAST);

-- ============================================================================
-- Table: installation_snapshots
-- Before/after installation diffs (registry, files, shortcuts, services)
-- ============================================================================
CREATE TABLE IF NOT EXISTS installation_snapshots (
  id SERIAL PRIMARY KEY,
  winget_id TEXT NOT NULL,
  version TEXT NOT NULL,

  -- Scan metadata
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scan_duration_seconds INTEGER,
  scan_status TEXT DEFAULT 'pending',        -- pending, completed, failed
  scan_error TEXT,

  -- Registry changes (JSONB)
  registry_changes JSONB DEFAULT '{
    "added": [],
    "modified": [],
    "removed": []
  }',

  -- File system changes (JSONB)
  file_changes JSONB DEFAULT '{
    "added": [],
    "modified": [],
    "removed": []
  }',

  -- Shortcuts created
  shortcuts_created JSONB DEFAULT '[]',      -- Array of {name, path, target, icon}

  -- Services created
  services_created JSONB DEFAULT '[]',       -- Array of {name, display_name, start_type}

  -- Extracted metadata
  install_path TEXT,                         -- Primary installation directory
  uninstall_string TEXT,                     -- Registry uninstall command
  installed_size_bytes BIGINT,               -- Total size of installed files

  -- Environment
  os_version TEXT,                           -- Windows version used for scan
  architecture TEXT,                         -- x64, arm64

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(winget_id, version)
);

-- Indexes for installation_snapshots
CREATE INDEX IF NOT EXISTS idx_installation_snapshots_winget_id ON installation_snapshots (winget_id);
CREATE INDEX IF NOT EXISTS idx_installation_snapshots_version ON installation_snapshots (winget_id, version);
CREATE INDEX IF NOT EXISTS idx_installation_snapshots_status ON installation_snapshots (scan_status);

-- ============================================================================
-- Modify existing winget_packages table
-- Add columns for curated system integration
-- ============================================================================
ALTER TABLE winget_packages
  ADD COLUMN IF NOT EXISTS is_curated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS icon_path TEXT,
  ADD COLUMN IF NOT EXISTS chocolatey_downloads BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Index for curated packages
CREATE INDEX IF NOT EXISTS idx_winget_packages_curated ON winget_packages (is_curated) WHERE is_curated = TRUE;

-- ============================================================================
-- Table: curated_sync_status
-- Track sync status for curated catalog workflows
-- ============================================================================
CREATE TABLE IF NOT EXISTS curated_sync_status (
  id TEXT PRIMARY KEY,                       -- workflow name
  last_run_started_at TIMESTAMPTZ,
  last_run_completed_at TIMESTAMPTZ,
  last_run_status TEXT,                      -- pending, running, success, failed
  items_processed INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',               -- Additional workflow-specific data
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial status rows
INSERT INTO curated_sync_status (id, last_run_status)
VALUES
  ('build-app-list', 'never_run'),
  ('sync-manifests', 'never_run'),
  ('extract-icons', 'never_run'),
  ('scan-apps', 'never_run')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- RLS Policies
-- ============================================================================
ALTER TABLE curated_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE version_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE curated_sync_status ENABLE ROW LEVEL SECURITY;

-- Public read access for all curated tables
CREATE POLICY "Public read curated_apps" ON curated_apps FOR SELECT USING (true);
CREATE POLICY "Public read version_history" ON version_history FOR SELECT USING (true);
CREATE POLICY "Public read installation_snapshots" ON installation_snapshots FOR SELECT USING (true);
CREATE POLICY "Public read curated_sync_status" ON curated_sync_status FOR SELECT USING (true);

-- Service role write access
CREATE POLICY "Service write curated_apps" ON curated_apps FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write version_history" ON version_history FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write installation_snapshots" ON installation_snapshots FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write curated_sync_status" ON curated_sync_status FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Search Functions
-- ============================================================================

-- Search curated apps with ranking
CREATE OR REPLACE FUNCTION search_curated_apps(
  search_query TEXT,
  category_filter TEXT DEFAULT NULL,
  result_limit INTEGER DEFAULT 50
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
  LIMIT result_limit;
$$;

-- Get popular curated apps
CREATE OR REPLACE FUNCTION get_popular_curated_apps(
  result_limit INTEGER DEFAULT 50,
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
  LIMIT result_limit;
$$;

-- Get installation changelog for an app
CREATE OR REPLACE FUNCTION get_installation_changelog(
  app_winget_id TEXT,
  app_version TEXT DEFAULT NULL
)
RETURNS TABLE (
  winget_id TEXT,
  version TEXT,
  scanned_at TIMESTAMPTZ,
  scan_status TEXT,
  registry_changes JSONB,
  file_changes JSONB,
  shortcuts_created JSONB,
  services_created JSONB,
  install_path TEXT,
  uninstall_string TEXT,
  installed_size_bytes BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    s.winget_id,
    s.version,
    s.scanned_at,
    s.scan_status,
    s.registry_changes,
    s.file_changes,
    s.shortcuts_created,
    s.services_created,
    s.install_path,
    s.uninstall_string,
    s.installed_size_bytes
  FROM installation_snapshots s
  WHERE
    s.winget_id = app_winget_id
    AND (app_version IS NULL OR s.version = app_version)
    AND s.scan_status = 'completed'
  ORDER BY s.scanned_at DESC
  LIMIT 1;
$$;

-- Get version history for an app
CREATE OR REPLACE FUNCTION get_version_history(
  app_winget_id TEXT,
  result_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  version TEXT,
  release_date TIMESTAMPTZ,
  release_notes TEXT,
  installer_type TEXT,
  installer_url TEXT,
  installers JSONB,
  manifest_fetched_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  SELECT
    vh.version,
    vh.release_date,
    vh.release_notes,
    vh.installer_type,
    vh.installer_url,
    vh.installers,
    vh.manifest_fetched_at
  FROM version_history vh
  WHERE vh.winget_id = app_winget_id
  ORDER BY vh.created_at DESC
  LIMIT result_limit;
$$;

-- Get all categories with counts
CREATE OR REPLACE FUNCTION get_curated_categories()
RETURNS TABLE (
  category TEXT,
  app_count BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    ca.category,
    COUNT(*) as app_count
  FROM curated_apps ca
  WHERE ca.is_verified = TRUE AND ca.category IS NOT NULL
  GROUP BY ca.category
  ORDER BY app_count DESC;
$$;
