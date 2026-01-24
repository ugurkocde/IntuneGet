-- Migration: Add packager support for local packaging service
-- This enables true self-hosting by allowing a local Windows packager
-- to claim and process jobs instead of GitHub Actions

-- Add columns for packager tracking
ALTER TABLE packaging_jobs ADD COLUMN IF NOT EXISTS packager_id TEXT;
ALTER TABLE packaging_jobs ADD COLUMN IF NOT EXISTS packager_heartbeat_at TIMESTAMPTZ;
ALTER TABLE packaging_jobs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Add index for efficient job polling (queued jobs ordered by creation)
CREATE INDEX IF NOT EXISTS idx_packaging_jobs_queued_for_packager
ON packaging_jobs(status, created_at) WHERE status = 'queued';

-- Add index for finding stale jobs (jobs that were claimed but packager stopped heartbeating)
CREATE INDEX IF NOT EXISTS idx_packaging_jobs_stale_detection
ON packaging_jobs(packager_id, packager_heartbeat_at) WHERE status = 'packaging';

-- Add comments for documentation
COMMENT ON COLUMN packaging_jobs.packager_id IS 'Unique identifier of the packager instance that claimed this job';
COMMENT ON COLUMN packaging_jobs.packager_heartbeat_at IS 'Last heartbeat timestamp from the packager processing this job';
COMMENT ON COLUMN packaging_jobs.claimed_at IS 'Timestamp when the job was claimed by a packager';
