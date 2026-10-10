-- Upgrade to winget-pkgs-index v2
-- Adds support for Tags and LastUpdate fields from the v2 index

-- Add column to track when package was last updated in winget repo
ALTER TABLE curated_apps
  ADD COLUMN IF NOT EXISTS winget_last_update TIMESTAMPTZ;

-- Index for querying recently updated packages
CREATE INDEX IF NOT EXISTS idx_curated_apps_winget_last_update
  ON curated_apps (winget_last_update DESC NULLS LAST);

-- Add comment for documentation
COMMENT ON COLUMN curated_apps.winget_last_update IS 'Timestamp from winget-pkgs-index v2 indicating when the package was last updated in the winget-pkgs repository';
