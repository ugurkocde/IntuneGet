-- Add cancellation tracking columns to packaging_jobs
-- This migration adds support for cancelling pending/in-process uploads

ALTER TABLE packaging_jobs
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS cancelled_by TEXT;

-- Add index for querying cancelled jobs
CREATE INDEX IF NOT EXISTS idx_packaging_jobs_cancelled_at ON packaging_jobs(cancelled_at)
WHERE cancelled_at IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN packaging_jobs.cancelled_at IS 'Timestamp when the job was cancelled';
COMMENT ON COLUMN packaging_jobs.cancelled_by IS 'Email or identifier of the user who cancelled the job';
