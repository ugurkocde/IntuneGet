-- Preserve packaging job records that are referenced by upload history while
-- allowing users to hide terminal jobs from the uploads page.
ALTER TABLE packaging_jobs
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warnings JSONB;

CREATE INDEX IF NOT EXISTS idx_packaging_jobs_active_history
  ON packaging_jobs(user_id, created_at DESC)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN packaging_jobs.archived_at IS
  'Soft-delete timestamp. Archived jobs remain available to update history and audit references.';

COMMENT ON COLUMN packaging_jobs.warnings IS
  'Non-fatal deployment warnings such as assignment or category application failures.';
