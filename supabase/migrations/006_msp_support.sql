-- IntuneGet: MSP (Managed Service Provider) Support
-- Migration: 006_msp_support
-- Description: Adds tables for MSP functionality to manage multiple customer tenants

-- ============================================
-- MSP Organizations Table
-- ============================================
-- Stores MSP organization information

CREATE TABLE IF NOT EXISTS msp_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Organization details
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,

  -- Primary tenant (MSP's own tenant)
  primary_tenant_id TEXT NOT NULL,

  -- Creator information
  created_by_user_id TEXT NOT NULL,
  created_by_email TEXT,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for msp_organizations
CREATE INDEX IF NOT EXISTS idx_msp_organizations_slug ON msp_organizations(slug);
CREATE INDEX IF NOT EXISTS idx_msp_organizations_primary_tenant ON msp_organizations(primary_tenant_id);
CREATE INDEX IF NOT EXISTS idx_msp_organizations_created_by ON msp_organizations(created_by_user_id);

-- ============================================
-- MSP Managed Tenants Table
-- ============================================
-- Stores customer tenants managed by an MSP

CREATE TABLE IF NOT EXISTS msp_managed_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to MSP organization
  msp_organization_id UUID NOT NULL REFERENCES msp_organizations(id) ON DELETE CASCADE,

  -- Tenant identification
  tenant_id TEXT,
  tenant_name TEXT,
  display_name TEXT NOT NULL,

  -- Consent status
  consent_status TEXT NOT NULL DEFAULT 'pending' CHECK (consent_status IN ('pending', 'granted', 'revoked')),
  consent_granted_at TIMESTAMP WITH TIME ZONE,
  consented_by_email TEXT,

  -- Management metadata
  added_by_user_id TEXT NOT NULL,
  notes TEXT,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for msp_managed_tenants
CREATE INDEX IF NOT EXISTS idx_msp_managed_tenants_org ON msp_managed_tenants(msp_organization_id);
CREATE INDEX IF NOT EXISTS idx_msp_managed_tenants_tenant ON msp_managed_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_msp_managed_tenants_consent_status ON msp_managed_tenants(consent_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_msp_managed_tenants_unique_tenant
  ON msp_managed_tenants(msp_organization_id, tenant_id)
  WHERE tenant_id IS NOT NULL;

-- ============================================
-- MSP User Memberships Table
-- ============================================
-- Stores users who belong to an MSP organization

CREATE TABLE IF NOT EXISTS msp_user_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to MSP organization
  msp_organization_id UUID NOT NULL REFERENCES msp_organizations(id) ON DELETE CASCADE,

  -- User information
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_name TEXT,
  user_tenant_id TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unique constraint: one user per organization
  UNIQUE(msp_organization_id, user_id)
);

-- Indexes for msp_user_memberships
CREATE INDEX IF NOT EXISTS idx_msp_user_memberships_org ON msp_user_memberships(msp_organization_id);
CREATE INDEX IF NOT EXISTS idx_msp_user_memberships_user ON msp_user_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_msp_user_memberships_email ON msp_user_memberships(user_email);

-- ============================================
-- Row Level Security Policies
-- ============================================

ALTER TABLE msp_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE msp_managed_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE msp_user_memberships ENABLE ROW LEVEL SECURITY;

-- Service role has full access to all MSP tables
CREATE POLICY "Service role has full access to msp_organizations"
ON msp_organizations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role has full access to msp_managed_tenants"
ON msp_managed_tenants
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role has full access to msp_user_memberships"
ON msp_user_memberships
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- Updated At Triggers
-- ============================================

DROP TRIGGER IF EXISTS update_msp_organizations_updated_at ON msp_organizations;
CREATE TRIGGER update_msp_organizations_updated_at
  BEFORE UPDATE ON msp_organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_msp_managed_tenants_updated_at ON msp_managed_tenants;
CREATE TRIGGER update_msp_managed_tenants_updated_at
  BEFORE UPDATE ON msp_managed_tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_msp_user_memberships_updated_at ON msp_user_memberships;
CREATE TRIGGER update_msp_user_memberships_updated_at
  BEFORE UPDATE ON msp_user_memberships
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- MSP Organization Stats View
-- ============================================
-- Provides aggregated statistics for MSP organizations

CREATE OR REPLACE VIEW msp_organization_stats AS
SELECT
  mo.id AS organization_id,
  mo.name AS organization_name,
  mo.slug,
  mo.is_active,
  COUNT(DISTINCT mmt.id) FILTER (WHERE mmt.is_active = true) AS total_tenants,
  COUNT(DISTINCT mmt.id) FILTER (WHERE mmt.consent_status = 'granted' AND mmt.is_active = true) AS active_tenants,
  COUNT(DISTINCT mmt.id) FILTER (WHERE mmt.consent_status = 'pending' AND mmt.is_active = true) AS pending_tenants,
  COUNT(DISTINCT mum.id) AS total_members,
  (
    SELECT COUNT(*)
    FROM packaging_jobs pj
    WHERE pj.tenant_id IN (
      SELECT tenant_id FROM msp_managed_tenants
      WHERE msp_organization_id = mo.id AND tenant_id IS NOT NULL
    )
  ) AS total_jobs,
  (
    SELECT COUNT(*)
    FROM packaging_jobs pj
    WHERE pj.tenant_id IN (
      SELECT tenant_id FROM msp_managed_tenants
      WHERE msp_organization_id = mo.id AND tenant_id IS NOT NULL
    )
    AND pj.status = 'completed'
  ) AS completed_jobs,
  mo.created_at,
  mo.updated_at
FROM msp_organizations mo
LEFT JOIN msp_managed_tenants mmt ON mo.id = mmt.msp_organization_id
LEFT JOIN msp_user_memberships mum ON mo.id = mum.msp_organization_id
GROUP BY mo.id, mo.name, mo.slug, mo.is_active, mo.created_at, mo.updated_at;
