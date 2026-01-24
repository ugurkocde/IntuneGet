-- IntuneGet: Packaging Jobs Schema
-- Migration: 001_packaging_jobs
-- Description: Creates tables for tracking packaging jobs and upload history

-- ============================================
-- Packaging Jobs Table
-- ============================================
-- Tracks jobs sent to Azure DevOps for packaging

CREATE TABLE IF NOT EXISTS packaging_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User identification (from Microsoft token)
  user_id TEXT NOT NULL,
  user_email TEXT,

  -- Package information
  winget_id TEXT NOT NULL,
  version TEXT NOT NULL,
  display_name TEXT NOT NULL,
  publisher TEXT,
  architecture TEXT DEFAULT 'x64',
  installer_type TEXT NOT NULL,
  installer_url TEXT NOT NULL,
  installer_sha256 TEXT,

  -- Installation configuration
  install_command TEXT,
  uninstall_command TEXT,
  install_scope TEXT DEFAULT 'machine',
  detection_rules JSONB,

  -- Full package configuration (for reference)
  package_config JSONB,

  -- Azure DevOps Pipeline info
  pipeline_run_id INTEGER,
  pipeline_run_url TEXT,

  -- Packaging results
  intunewin_url TEXT,
  intunewin_size_bytes BIGINT,
  unencrypted_content_size BIGINT,
  encryption_info JSONB,

  -- Intune upload results
  intune_app_id TEXT,
  intune_app_url TEXT,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'queued',
  -- Status values: queued, packaging, completed, failed, uploading, deployed
  status_message TEXT,
  progress_percent INTEGER DEFAULT 0,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  packaging_started_at TIMESTAMP WITH TIME ZONE,
  packaging_completed_at TIMESTAMP WITH TIME ZONE,
  upload_started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_packaging_jobs_user_id ON packaging_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_packaging_jobs_status ON packaging_jobs(status);
CREATE INDEX IF NOT EXISTS idx_packaging_jobs_winget_id ON packaging_jobs(winget_id);
CREATE INDEX IF NOT EXISTS idx_packaging_jobs_created_at ON packaging_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_packaging_jobs_pipeline_run_id ON packaging_jobs(pipeline_run_id);

-- ============================================
-- Row Level Security (RLS)
-- ============================================
-- Note: Since we're using Microsoft tokens (not Supabase Auth),
-- we'll use service role for server-side operations.
-- RLS policies here are for reference if you switch to Supabase Auth.

ALTER TABLE packaging_jobs ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role has full access to packaging_jobs"
ON packaging_jobs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy: Authenticated users can view their own jobs (if using Supabase Auth)
-- Uncomment if you integrate Supabase Auth
-- CREATE POLICY "Users can view own jobs"
-- ON packaging_jobs
-- FOR SELECT
-- TO authenticated
-- USING (user_id = auth.uid()::text);

-- ============================================
-- Updated At Trigger
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_packaging_jobs_updated_at ON packaging_jobs;

CREATE TRIGGER update_packaging_jobs_updated_at
  BEFORE UPDATE ON packaging_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Upload History Table (Optional)
-- ============================================
-- For tracking successfully deployed apps

CREATE TABLE IF NOT EXISTS upload_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to packaging job
  packaging_job_id UUID REFERENCES packaging_jobs(id) ON DELETE SET NULL,

  -- User
  user_id TEXT NOT NULL,

  -- App info
  winget_id TEXT NOT NULL,
  version TEXT NOT NULL,
  display_name TEXT NOT NULL,
  publisher TEXT,

  -- Intune info
  intune_app_id TEXT NOT NULL,
  intune_app_url TEXT,
  intune_tenant_id TEXT,

  -- Timestamps
  deployed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_upload_history_user_id ON upload_history(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_history_winget_id ON upload_history(winget_id);
CREATE INDEX IF NOT EXISTS idx_upload_history_deployed_at ON upload_history(deployed_at DESC);

ALTER TABLE upload_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to upload_history"
ON upload_history
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- Statistics View
-- ============================================

CREATE OR REPLACE VIEW packaging_stats AS
SELECT
  user_id,
  COUNT(*) AS total_jobs,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed_jobs,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_jobs,
  COUNT(*) FILTER (WHERE status IN ('queued', 'packaging')) AS pending_jobs,
  MAX(created_at) AS last_job_at
FROM packaging_jobs
GROUP BY user_id;

-- ============================================
-- Cleanup Function (Optional)
-- ============================================
-- Remove old completed jobs to save space

CREATE OR REPLACE FUNCTION cleanup_old_packaging_jobs(days_to_keep INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM packaging_jobs
  WHERE status IN ('completed', 'failed')
    AND created_at < NOW() - (days_to_keep || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Example usage: SELECT cleanup_old_packaging_jobs(30);
