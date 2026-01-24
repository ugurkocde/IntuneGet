-- Add quiet_uninstall_string column to installation_snapshots
-- This column stores the QuietUninstallString registry value for silent uninstallation

ALTER TABLE installation_snapshots
  ADD COLUMN IF NOT EXISTS quiet_uninstall_string TEXT;

-- Drop old function first (return type changed)
DROP FUNCTION IF EXISTS get_installation_changelog(TEXT, TEXT);

-- Recreate the get_installation_changelog function with the new column
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
  quiet_uninstall_string TEXT,
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
    s.quiet_uninstall_string,
    s.installed_size_bytes
  FROM installation_snapshots s
  WHERE
    s.winget_id = app_winget_id
    AND (app_version IS NULL OR s.version = app_version)
    AND s.scan_status = 'completed'
  ORDER BY s.scanned_at DESC
  LIMIT 1;
$$;
