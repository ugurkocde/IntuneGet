-- Migration 015: MSP Batch Deployments and Webhooks
-- This migration adds tables for batch deployment and webhook functionality

-- ============================================
-- MSP Batch Deployments
-- ============================================

-- Batch deployment header table
CREATE TABLE IF NOT EXISTS msp_batch_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES msp_organizations(id) ON DELETE CASCADE,
  created_by_user_id TEXT NOT NULL,
  created_by_email TEXT NOT NULL,
  winget_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled', 'failed')),
  total_tenants INTEGER NOT NULL DEFAULT 0,
  completed_tenants INTEGER NOT NULL DEFAULT 0,
  failed_tenants INTEGER NOT NULL DEFAULT 0,
  concurrency_limit INTEGER NOT NULL DEFAULT 3 CHECK (concurrency_limit >= 1 AND concurrency_limit <= 10),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by_email TEXT
);

-- Batch deployment items (one per tenant)
CREATE TABLE IF NOT EXISTS msp_batch_deployment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES msp_batch_deployments(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  tenant_display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped')),
  packaging_job_id UUID REFERENCES packaging_jobs(id),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE(batch_id, tenant_id)
);

-- Indexes for batch deployments
CREATE INDEX IF NOT EXISTS idx_msp_batch_deployments_org ON msp_batch_deployments(organization_id);
CREATE INDEX IF NOT EXISTS idx_msp_batch_deployments_status ON msp_batch_deployments(status);
CREATE INDEX IF NOT EXISTS idx_msp_batch_deployments_created ON msp_batch_deployments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msp_batch_deployment_items_batch ON msp_batch_deployment_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_msp_batch_deployment_items_status ON msp_batch_deployment_items(status);

-- ============================================
-- MSP Webhooks
-- ============================================

-- Webhook configurations
CREATE TABLE IF NOT EXISTS msp_webhook_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES msp_organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  headers JSONB NOT NULL DEFAULT '{}',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_failure_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_email TEXT NOT NULL
);

-- Webhook delivery log
CREATE TABLE IF NOT EXISTS msp_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES msp_webhook_configurations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  response_status INTEGER,
  response_body TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ
);

-- Indexes for webhooks
CREATE INDEX IF NOT EXISTS idx_msp_webhook_configurations_org ON msp_webhook_configurations(organization_id);
CREATE INDEX IF NOT EXISTS idx_msp_webhook_configurations_enabled ON msp_webhook_configurations(is_enabled);
CREATE INDEX IF NOT EXISTS idx_msp_webhook_deliveries_webhook ON msp_webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_msp_webhook_deliveries_status ON msp_webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_msp_webhook_deliveries_created ON msp_webhook_deliveries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msp_webhook_deliveries_retry ON msp_webhook_deliveries(next_retry_at) WHERE status = 'pending' AND attempts < max_attempts;

-- Trigger to update updated_at on webhook configurations
CREATE OR REPLACE FUNCTION update_msp_webhook_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_msp_webhook_updated_at
  BEFORE UPDATE ON msp_webhook_configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_msp_webhook_updated_at();

-- ============================================
-- Row Level Security Policies
-- ============================================

-- Enable RLS
ALTER TABLE msp_batch_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE msp_batch_deployment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE msp_webhook_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE msp_webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (for backend operations)
CREATE POLICY "Service role full access on msp_batch_deployments"
ON msp_batch_deployments
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role full access on msp_batch_deployment_items"
ON msp_batch_deployment_items
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role full access on msp_webhook_configurations"
ON msp_webhook_configurations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role full access on msp_webhook_deliveries"
ON msp_webhook_deliveries
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- Views for Batch Deployment Stats
-- ============================================

CREATE OR REPLACE VIEW msp_batch_deployment_stats AS
SELECT
  bd.organization_id,
  COUNT(*) AS total_batches,
  COUNT(*) FILTER (WHERE bd.status = 'completed') AS completed_batches,
  COUNT(*) FILTER (WHERE bd.status = 'failed') AS failed_batches,
  COUNT(*) FILTER (WHERE bd.status IN ('pending', 'in_progress')) AS active_batches,
  SUM(bd.total_tenants) AS total_tenant_deployments,
  SUM(bd.completed_tenants) AS successful_deployments,
  SUM(bd.failed_tenants) AS failed_deployments
FROM msp_batch_deployments bd
GROUP BY bd.organization_id;
