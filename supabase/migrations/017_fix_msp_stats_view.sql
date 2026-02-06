-- IntuneGet: Fix MSP Organization Stats View
-- Migration: 017_fix_msp_stats_view
-- Description: Fixes the msp_organization_stats view to:
--   1. Exclude inactive tenants from job count subqueries
--   2. Include 'deployed' status alongside 'completed' for consistency

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
      WHERE msp_organization_id = mo.id AND tenant_id IS NOT NULL AND is_active = true
    )
  ) AS total_jobs,
  (
    SELECT COUNT(*)
    FROM packaging_jobs pj
    WHERE pj.tenant_id IN (
      SELECT tenant_id FROM msp_managed_tenants
      WHERE msp_organization_id = mo.id AND tenant_id IS NOT NULL AND is_active = true
    )
    AND (pj.status = 'completed' OR pj.status = 'deployed')
  ) AS completed_jobs,
  mo.created_at,
  mo.updated_at
FROM msp_organizations mo
LEFT JOIN msp_managed_tenants mmt ON mo.id = mmt.msp_organization_id
LEFT JOIN msp_user_memberships mum ON mo.id = mum.msp_organization_id
GROUP BY mo.id, mo.name, mo.slug, mo.is_active, mo.created_at, mo.updated_at;
