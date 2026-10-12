-- SCCM to Intune Migration Tables
-- Enables IT admins to import SCCM applications and migrate them to Intune
-- Integrates with existing discovered apps infrastructure

-- ============================================================================
-- Table: sccm_migrations
-- Migration sessions with metadata and statistics
-- ============================================================================
CREATE TABLE IF NOT EXISTS sccm_migrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,

  -- Migration info
  name TEXT NOT NULL,
  description TEXT,

  -- Source info
  source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'powershell', 'json')),
  source_site_code TEXT,
  source_site_name TEXT,
  imported_file_name TEXT,

  -- Statistics (denormalized for performance)
  total_apps INTEGER DEFAULT 0,
  matched_apps INTEGER DEFAULT 0,
  partial_match_apps INTEGER DEFAULT 0,
  unmatched_apps INTEGER DEFAULT 0,
  excluded_apps INTEGER DEFAULT 0,
  migrated_apps INTEGER DEFAULT 0,
  failed_apps INTEGER DEFAULT 0,

  -- Status
  status TEXT DEFAULT 'importing' CHECK (status IN (
    'importing', 'matching', 'ready', 'migrating', 'completed', 'error'
  )),
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_migration_at TIMESTAMPTZ,

  -- Foreign key to user profiles
  CONSTRAINT fk_sccm_migrations_user FOREIGN KEY (user_id)
    REFERENCES user_profiles(id) ON DELETE CASCADE
);

-- Indexes for sccm_migrations
CREATE INDEX IF NOT EXISTS idx_sccm_migrations_user_id ON sccm_migrations (user_id);
CREATE INDEX IF NOT EXISTS idx_sccm_migrations_tenant_id ON sccm_migrations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sccm_migrations_status ON sccm_migrations (status);
CREATE INDEX IF NOT EXISTS idx_sccm_migrations_created_at ON sccm_migrations (created_at DESC);

-- ============================================================================
-- Table: sccm_apps
-- Individual SCCM applications with match and migration status
-- ============================================================================
CREATE TABLE IF NOT EXISTS sccm_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id UUID NOT NULL REFERENCES sccm_migrations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,

  -- SCCM app identifiers
  sccm_ci_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  manufacturer TEXT,
  version TEXT,
  technology TEXT CHECK (technology IN (
    'MSI', 'Script', 'MSIX', 'AppV', 'Deeplink', 'WinGetApp', 'MacOS', 'Unknown'
  )),
  is_deployed BOOLEAN DEFAULT FALSE,
  deployment_count INTEGER DEFAULT 0,

  -- Original SCCM data (complete application record)
  sccm_app_data JSONB NOT NULL,
  sccm_detection_rules JSONB DEFAULT '[]',
  sccm_install_command TEXT,
  sccm_uninstall_command TEXT,
  sccm_install_behavior TEXT,
  sccm_admin_categories TEXT[] DEFAULT '{}',

  -- Matching
  match_status TEXT DEFAULT 'pending' CHECK (match_status IN (
    'pending', 'matched', 'partial', 'unmatched', 'manual', 'excluded', 'skipped'
  )),
  match_confidence REAL,
  matched_winget_id TEXT,
  matched_winget_name TEXT,
  partial_matches JSONB DEFAULT '[]',
  matched_at TIMESTAMPTZ,
  matched_by TEXT CHECK (matched_by IN ('auto', 'manual', 'mapping')),

  -- Migration settings
  preserve_detection_rules BOOLEAN DEFAULT TRUE,
  preserve_install_commands BOOLEAN DEFAULT FALSE,
  use_winget_defaults BOOLEAN DEFAULT TRUE,
  custom_settings JSONB,

  -- Converted settings (after conversion)
  converted_detection_rules JSONB,
  converted_install_behavior TEXT CHECK (converted_install_behavior IN ('system', 'user')),

  -- Migration status
  migration_status TEXT DEFAULT 'pending' CHECK (migration_status IN (
    'pending', 'queued', 'migrating', 'completed', 'failed', 'skipped'
  )),
  migration_error TEXT,
  intune_app_id TEXT,
  migrated_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per migration
  UNIQUE(migration_id, sccm_ci_id)
);

-- Indexes for sccm_apps
CREATE INDEX IF NOT EXISTS idx_sccm_apps_migration_id ON sccm_apps (migration_id);
CREATE INDEX IF NOT EXISTS idx_sccm_apps_user_id ON sccm_apps (user_id);
CREATE INDEX IF NOT EXISTS idx_sccm_apps_tenant_id ON sccm_apps (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sccm_apps_match_status ON sccm_apps (match_status);
CREATE INDEX IF NOT EXISTS idx_sccm_apps_migration_status ON sccm_apps (migration_status);
CREATE INDEX IF NOT EXISTS idx_sccm_apps_matched_winget_id ON sccm_apps (matched_winget_id);
CREATE INDEX IF NOT EXISTS idx_sccm_apps_display_name ON sccm_apps (display_name);
CREATE INDEX IF NOT EXISTS idx_sccm_apps_technology ON sccm_apps (technology);

-- Full-text search index for SCCM apps
ALTER TABLE sccm_apps ADD COLUMN IF NOT EXISTS fts TSVECTOR GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(manufacturer, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(sccm_ci_id, '')), 'C')
) STORED;

CREATE INDEX IF NOT EXISTS idx_sccm_apps_fts ON sccm_apps USING GIN (fts);

-- ============================================================================
-- Table: sccm_winget_mappings
-- Custom SCCM to WinGet package mappings (user-created or community)
-- ============================================================================
CREATE TABLE IF NOT EXISTS sccm_winget_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SCCM identifiers (multiple for flexible matching)
  sccm_display_name TEXT NOT NULL,
  sccm_display_name_normalized TEXT NOT NULL,
  sccm_manufacturer TEXT,
  sccm_ci_id TEXT,
  sccm_product_code TEXT,  -- MSI product code

  -- WinGet target
  winget_package_id TEXT NOT NULL,
  winget_package_name TEXT,

  -- Metadata
  confidence REAL DEFAULT 1.0,
  is_verified BOOLEAN DEFAULT FALSE,
  usage_count INTEGER DEFAULT 0,

  -- Scope
  created_by TEXT,  -- User ID who created the mapping
  tenant_id TEXT,   -- NULL = global mapping available to all

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint on normalized name per scope
  UNIQUE(sccm_display_name_normalized, tenant_id)
);

-- Indexes for sccm_winget_mappings
CREATE INDEX IF NOT EXISTS idx_sccm_mappings_display_name ON sccm_winget_mappings (sccm_display_name_normalized);
CREATE INDEX IF NOT EXISTS idx_sccm_mappings_winget_id ON sccm_winget_mappings (winget_package_id);
CREATE INDEX IF NOT EXISTS idx_sccm_mappings_product_code ON sccm_winget_mappings (sccm_product_code) WHERE sccm_product_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sccm_mappings_tenant_id ON sccm_winget_mappings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sccm_mappings_verified ON sccm_winget_mappings (is_verified) WHERE is_verified = TRUE;

-- ============================================================================
-- Table: sccm_migration_history
-- Audit log of all migration actions
-- ============================================================================
CREATE TABLE IF NOT EXISTS sccm_migration_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_id UUID NOT NULL REFERENCES sccm_migrations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,

  -- Action details
  action TEXT NOT NULL CHECK (action IN (
    'migration_created',
    'apps_imported',
    'matching_started',
    'matching_completed',
    'app_matched_auto',
    'app_matched_manual',
    'app_excluded',
    'app_unexcluded',
    'migration_started',
    'migration_completed',
    'migration_failed',
    'settings_updated',
    'migration_deleted'
  )),
  app_id UUID REFERENCES sccm_apps(id) ON DELETE SET NULL,
  app_name TEXT,

  -- Data snapshots
  previous_value JSONB,
  new_value JSONB,

  -- Results
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  affected_count INTEGER,

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for sccm_migration_history
CREATE INDEX IF NOT EXISTS idx_sccm_history_migration_id ON sccm_migration_history (migration_id);
CREATE INDEX IF NOT EXISTS idx_sccm_history_user_id ON sccm_migration_history (user_id);
CREATE INDEX IF NOT EXISTS idx_sccm_history_tenant_id ON sccm_migration_history (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sccm_history_action ON sccm_migration_history (action);
CREATE INDEX IF NOT EXISTS idx_sccm_history_created_at ON sccm_migration_history (created_at DESC);

-- ============================================================================
-- RLS Policies
-- ============================================================================
ALTER TABLE sccm_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sccm_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE sccm_winget_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sccm_migration_history ENABLE ROW LEVEL SECURITY;

-- Service role has full access
DROP POLICY IF EXISTS "Service role full access sccm_migrations" ON sccm_migrations;
CREATE POLICY "Service role full access sccm_migrations"
  ON sccm_migrations FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access sccm_apps" ON sccm_apps;
CREATE POLICY "Service role full access sccm_apps"
  ON sccm_apps FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access sccm_winget_mappings" ON sccm_winget_mappings;
CREATE POLICY "Service role full access sccm_winget_mappings"
  ON sccm_winget_mappings FOR ALL
  USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access sccm_migration_history" ON sccm_migration_history;
CREATE POLICY "Service role full access sccm_migration_history"
  ON sccm_migration_history FOR ALL
  USING (auth.role() = 'service_role');

-- Public read access for global mappings
DROP POLICY IF EXISTS "Public read global sccm_winget_mappings" ON sccm_winget_mappings;
CREATE POLICY "Public read global sccm_winget_mappings"
  ON sccm_winget_mappings FOR SELECT
  USING (tenant_id IS NULL);

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_sccm_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sccm_migrations_updated_at ON sccm_migrations;
CREATE TRIGGER trigger_sccm_migrations_updated_at
  BEFORE UPDATE ON sccm_migrations
  FOR EACH ROW
  EXECUTE FUNCTION update_sccm_updated_at();

DROP TRIGGER IF EXISTS trigger_sccm_apps_updated_at ON sccm_apps;
CREATE TRIGGER trigger_sccm_apps_updated_at
  BEFORE UPDATE ON sccm_apps
  FOR EACH ROW
  EXECUTE FUNCTION update_sccm_updated_at();

DROP TRIGGER IF EXISTS trigger_sccm_mappings_updated_at ON sccm_winget_mappings;
CREATE TRIGGER trigger_sccm_mappings_updated_at
  BEFORE UPDATE ON sccm_winget_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_sccm_updated_at();

-- ============================================================================
-- Trigger: Update migration stats when apps change
-- ============================================================================
CREATE OR REPLACE FUNCTION update_sccm_migration_stats()
RETURNS TRIGGER AS $$
DECLARE
  migration_record RECORD;
BEGIN
  -- Get the migration ID from either OLD or NEW
  IF TG_OP = 'DELETE' THEN
    migration_record := OLD;
  ELSE
    migration_record := NEW;
  END IF;

  -- Update migration statistics
  UPDATE sccm_migrations
  SET
    total_apps = (
      SELECT COUNT(*) FROM sccm_apps WHERE migration_id = migration_record.migration_id
    ),
    matched_apps = (
      SELECT COUNT(*) FROM sccm_apps
      WHERE migration_id = migration_record.migration_id AND match_status = 'matched'
    ),
    partial_match_apps = (
      SELECT COUNT(*) FROM sccm_apps
      WHERE migration_id = migration_record.migration_id AND match_status = 'partial'
    ),
    unmatched_apps = (
      SELECT COUNT(*) FROM sccm_apps
      WHERE migration_id = migration_record.migration_id AND match_status = 'unmatched'
    ),
    excluded_apps = (
      SELECT COUNT(*) FROM sccm_apps
      WHERE migration_id = migration_record.migration_id AND match_status IN ('excluded', 'skipped')
    ),
    migrated_apps = (
      SELECT COUNT(*) FROM sccm_apps
      WHERE migration_id = migration_record.migration_id AND migration_status = 'completed'
    ),
    failed_apps = (
      SELECT COUNT(*) FROM sccm_apps
      WHERE migration_id = migration_record.migration_id AND migration_status = 'failed'
    ),
    updated_at = NOW()
  WHERE id = migration_record.migration_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sccm_apps_stats_update
  AFTER INSERT OR UPDATE OR DELETE ON sccm_apps
  FOR EACH ROW
  EXECUTE FUNCTION update_sccm_migration_stats();

-- ============================================================================
-- Functions: Search and Statistics
-- ============================================================================

-- Search SCCM apps in a migration
CREATE OR REPLACE FUNCTION search_sccm_apps(
  p_migration_id UUID,
  search_query TEXT DEFAULT NULL,
  match_status_filter TEXT DEFAULT NULL,
  migration_status_filter TEXT DEFAULT NULL,
  result_limit INTEGER DEFAULT 100,
  result_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  sccm_ci_id TEXT,
  display_name TEXT,
  manufacturer TEXT,
  version TEXT,
  technology TEXT,
  is_deployed BOOLEAN,
  deployment_count INTEGER,
  match_status TEXT,
  match_confidence REAL,
  matched_winget_id TEXT,
  matched_winget_name TEXT,
  partial_matches JSONB,
  migration_status TEXT,
  intune_app_id TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  SELECT
    a.id,
    a.sccm_ci_id,
    a.display_name,
    a.manufacturer,
    a.version,
    a.technology,
    a.is_deployed,
    a.deployment_count,
    a.match_status,
    a.match_confidence,
    a.matched_winget_id,
    a.matched_winget_name,
    a.partial_matches,
    a.migration_status,
    a.intune_app_id,
    a.created_at
  FROM sccm_apps a
  WHERE
    a.migration_id = p_migration_id
    AND (search_query IS NULL OR a.fts @@ websearch_to_tsquery('english', search_query))
    AND (match_status_filter IS NULL OR a.match_status = match_status_filter)
    AND (migration_status_filter IS NULL OR a.migration_status = migration_status_filter)
  ORDER BY a.deployment_count DESC, a.display_name ASC
  LIMIT result_limit
  OFFSET result_offset;
$$;

-- Get migration statistics
CREATE OR REPLACE FUNCTION get_sccm_migration_stats(p_migration_id UUID)
RETURNS TABLE (
  total_apps BIGINT,
  matched_apps BIGINT,
  partial_match_apps BIGINT,
  unmatched_apps BIGINT,
  excluded_apps BIGINT,
  pending_apps BIGINT,
  migrated_apps BIGINT,
  failed_apps BIGINT,
  total_deployment_count BIGINT,
  deployed_apps_count BIGINT,
  technology_breakdown JSONB
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*) as total_apps,
    COUNT(*) FILTER (WHERE a.match_status = 'matched') as matched_apps,
    COUNT(*) FILTER (WHERE a.match_status = 'partial') as partial_match_apps,
    COUNT(*) FILTER (WHERE a.match_status = 'unmatched') as unmatched_apps,
    COUNT(*) FILTER (WHERE a.match_status IN ('excluded', 'skipped')) as excluded_apps,
    COUNT(*) FILTER (WHERE a.match_status = 'pending') as pending_apps,
    COUNT(*) FILTER (WHERE a.migration_status = 'completed') as migrated_apps,
    COUNT(*) FILTER (WHERE a.migration_status = 'failed') as failed_apps,
    COALESCE(SUM(a.deployment_count), 0) as total_deployment_count,
    COUNT(*) FILTER (WHERE a.is_deployed = TRUE) as deployed_apps_count,
    COALESCE((
      SELECT jsonb_object_agg(tech_counts.technology, tech_counts.tech_count)
      FROM (
        SELECT COALESCE(technology, 'Unknown') AS technology, COUNT(*) AS tech_count
        FROM sccm_apps
        WHERE migration_id = p_migration_id
        GROUP BY COALESCE(technology, 'Unknown')
      ) tech_counts
    ), '{}'::jsonb) as technology_breakdown
  FROM sccm_apps a
  WHERE a.migration_id = p_migration_id;
$$;

-- Get SCCM mapping by name (for matching)
CREATE OR REPLACE FUNCTION get_sccm_mapping(
  p_display_name TEXT,
  p_tenant_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  winget_package_id TEXT,
  winget_package_name TEXT,
  confidence REAL,
  is_verified BOOLEAN
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.winget_package_id,
    m.winget_package_name,
    m.confidence,
    m.is_verified
  FROM sccm_winget_mappings m
  WHERE
    m.sccm_display_name_normalized = lower(trim(p_display_name))
    AND (m.tenant_id IS NULL OR m.tenant_id = p_tenant_id)
  ORDER BY
    CASE WHEN m.tenant_id = p_tenant_id THEN 0 ELSE 1 END,  -- Prefer tenant-specific
    m.is_verified DESC,
    m.usage_count DESC
  LIMIT 1;
$$;

-- Get dashboard statistics for all migrations
CREATE OR REPLACE FUNCTION get_sccm_dashboard_stats(p_tenant_id TEXT)
RETURNS TABLE (
  total_migrations BIGINT,
  total_apps BIGINT,
  matched_apps BIGINT,
  migrated_apps BIGINT,
  pending_migration BIGINT,
  failed_migration BIGINT
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(DISTINCT m.id) as total_migrations,
    COALESCE(SUM(m.total_apps), 0) as total_apps,
    COALESCE(SUM(m.matched_apps), 0) as matched_apps,
    COALESCE(SUM(m.migrated_apps), 0) as migrated_apps,
    COALESCE(SUM(m.total_apps - m.migrated_apps - m.failed_apps - m.excluded_apps), 0) as pending_migration,
    COALESCE(SUM(m.failed_apps), 0) as failed_migration
  FROM sccm_migrations m
  WHERE m.tenant_id = p_tenant_id;
$$;

-- Increment mapping usage count
CREATE OR REPLACE FUNCTION increment_sccm_mapping_usage(p_mapping_id UUID)
RETURNS VOID
LANGUAGE sql AS $$
  UPDATE sccm_winget_mappings
  SET usage_count = usage_count + 1
  WHERE id = p_mapping_id;
$$;

-- ============================================================================
-- Seed common SCCM to WinGet mappings
-- ============================================================================
INSERT INTO sccm_winget_mappings (
  sccm_display_name,
  sccm_display_name_normalized,
  sccm_manufacturer,
  winget_package_id,
  winget_package_name,
  confidence,
  is_verified
) SELECT * FROM (VALUES
  -- Browsers
  ('Google Chrome', 'google chrome', 'Google', 'Google.Chrome', 'Google Chrome', 1.0, TRUE),
  ('Mozilla Firefox', 'mozilla firefox', 'Mozilla', 'Mozilla.Firefox', 'Mozilla Firefox', 1.0, TRUE),
  ('Microsoft Edge', 'microsoft edge', 'Microsoft', 'Microsoft.Edge', 'Microsoft Edge', 1.0, TRUE),

  -- Microsoft Office
  ('Microsoft 365 Apps for enterprise', 'microsoft 365 apps for enterprise', 'Microsoft', 'Microsoft.Office', 'Microsoft 365 Apps', 1.0, TRUE),
  ('Microsoft Office Professional Plus', 'microsoft office professional plus', 'Microsoft', 'Microsoft.Office', 'Microsoft 365 Apps', 0.9, TRUE),

  -- Communication
  ('Microsoft Teams', 'microsoft teams', 'Microsoft', 'Microsoft.Teams', 'Microsoft Teams', 1.0, TRUE),
  ('Zoom', 'zoom', 'Zoom', 'Zoom.Zoom', 'Zoom', 1.0, TRUE),
  ('Slack', 'slack', 'Slack', 'SlackTechnologies.Slack', 'Slack', 1.0, TRUE),

  -- Development
  ('Visual Studio Code', 'visual studio code', 'Microsoft', 'Microsoft.VisualStudioCode', 'Visual Studio Code', 1.0, TRUE),
  ('Git', 'git', 'Git', 'Git.Git', 'Git', 1.0, TRUE),
  ('Node.js', 'node.js', 'Node.js', 'OpenJS.NodeJS.LTS', 'Node.js LTS', 1.0, TRUE),
  ('Python', 'python', 'Python', 'Python.Python.3.11', 'Python 3.11', 0.9, TRUE),

  -- Utilities
  ('7-Zip', '7-zip', '7-Zip', '7zip.7zip', '7-Zip', 1.0, TRUE),
  ('Adobe Acrobat Reader DC', 'adobe acrobat reader dc', 'Adobe', 'Adobe.Acrobat.Reader.64-bit', 'Adobe Acrobat Reader DC', 1.0, TRUE),
  ('Notepad++', 'notepad++', 'Notepad++', 'Notepad++.Notepad++', 'Notepad++', 1.0, TRUE),
  ('VLC media player', 'vlc media player', 'VideoLAN', 'VideoLAN.VLC', 'VLC media player', 1.0, TRUE),

  -- Remote Access
  ('TeamViewer', 'teamviewer', 'TeamViewer', 'TeamViewer.TeamViewer', 'TeamViewer', 1.0, TRUE),
  ('AnyDesk', 'anydesk', 'AnyDesk', 'AnyDeskSoftwareGmbH.AnyDesk', 'AnyDesk', 1.0, TRUE),

  -- Security
  ('KeePass', 'keepass', 'KeePass', 'DominikReichl.KeePass', 'KeePass', 1.0, TRUE),
  ('Bitwarden', 'bitwarden', 'Bitwarden', 'Bitwarden.Bitwarden', 'Bitwarden', 1.0, TRUE)
) AS seed (
  sccm_display_name,
  sccm_display_name_normalized,
  sccm_manufacturer,
  winget_package_id,
  winget_package_name,
  confidence,
  is_verified
)
WHERE NOT EXISTS (
  SELECT 1
  FROM sccm_winget_mappings existing
  WHERE existing.sccm_display_name_normalized = seed.sccm_display_name_normalized
    AND existing.tenant_id IS NULL
);
