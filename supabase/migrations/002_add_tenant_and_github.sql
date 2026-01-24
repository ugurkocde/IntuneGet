-- IntuneGet: Add Tenant ID and GitHub Actions Support
-- Migration: 002_add_tenant_and_github
-- Description: Adds tenant_id for multi-tenant support and GitHub run tracking columns

-- ============================================
-- Add tenant_id column for multi-tenant support
-- ============================================
-- This column stores the Entra ID tenant ID from the user's token
-- Used for service principal authentication to the user's Intune tenant

ALTER TABLE packaging_jobs ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- ============================================
-- Add GitHub Actions run tracking columns
-- ============================================
-- Replace Azure DevOps pipeline tracking with GitHub Actions

ALTER TABLE packaging_jobs ADD COLUMN IF NOT EXISTS github_run_id TEXT;
ALTER TABLE packaging_jobs ADD COLUMN IF NOT EXISTS github_run_url TEXT;

-- ============================================
-- Add silent_switches column for installation
-- ============================================
-- Stores the silent installation switches extracted from install command

ALTER TABLE packaging_jobs ADD COLUMN IF NOT EXISTS silent_switches TEXT;

-- ============================================
-- Indexes for common queries
-- ============================================

-- Index for tenant-based queries (multi-tenant support)
CREATE INDEX IF NOT EXISTS idx_packaging_jobs_tenant_id ON packaging_jobs(tenant_id);

-- Index for GitHub run queries
CREATE INDEX IF NOT EXISTS idx_packaging_jobs_github_run_id ON packaging_jobs(github_run_id);

-- ============================================
-- Update upload_history table
-- ============================================
-- Add tenant_id if not exists

ALTER TABLE upload_history ADD COLUMN IF NOT EXISTS intune_tenant_id TEXT;

-- Index for tenant-based history queries
CREATE INDEX IF NOT EXISTS idx_upload_history_tenant_id ON upload_history(intune_tenant_id);

-- ============================================
-- Admin Consent Tracking Table (Optional)
-- ============================================
-- Track which tenants have granted admin consent for the service principal

CREATE TABLE IF NOT EXISTS tenant_consent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant identification
  tenant_id TEXT NOT NULL UNIQUE,
  tenant_name TEXT,

  -- Consent details
  consented_by_user_id TEXT NOT NULL,
  consented_by_email TEXT,
  consent_granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Service principal info
  service_principal_id TEXT,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_consent_tenant_id ON tenant_consent(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_consent_user_id ON tenant_consent(consented_by_user_id);

ALTER TABLE tenant_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to tenant_consent"
ON tenant_consent
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_tenant_consent_updated_at ON tenant_consent;

CREATE TRIGGER update_tenant_consent_updated_at
  BEFORE UPDATE ON tenant_consent
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
