-- Track whether a detected update belongs to an IntuneGet-managed app
-- (deployed, claimed, or explicitly mapped through IntuneGet) versus an app
-- that was only matched to a winget package by fuzzy name heuristics.
--
-- Default is true because:
--   * the daily cron only scans upload_history (always managed), and
--   * existing rows predate this column and should remain visible until the
--     next refresh re-tags them.
-- The manual refresh path (live Intune scan) is the only writer that records
-- false, and it fully replaces a tenant's rows on each run, so any stale
-- defaults self-heal on the first refresh after deploy.
ALTER TABLE update_check_results
  ADD COLUMN IF NOT EXISTS is_managed BOOLEAN NOT NULL DEFAULT true;
