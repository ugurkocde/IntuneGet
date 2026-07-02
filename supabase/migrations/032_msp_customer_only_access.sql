-- IntuneGet: MSP Customer-Only Access Mode
-- Migration: 032_msp_customer_only_access
-- Description: Adds an access_mode column to MSP memberships and invitations so
-- members can be limited to customer tenants only (no access to the MSP's own
-- primary tenant). See GitHub issue #122.
--
-- Note: msp_invitations exists in production but was created out-of-band (no
-- tracked migration), so this file first creates it defensively for fresh
-- installs. Production has role as the msp_role enum; the defensive create
-- uses TEXT with an equivalent CHECK so the migration works either way.

-- ============================================
-- Defensive create for msp_invitations
-- ============================================
-- No-op in production where the table already exists.

CREATE TABLE IF NOT EXISTS msp_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to MSP organization
  organization_id UUID NOT NULL REFERENCES msp_organizations(id) ON DELETE CASCADE,

  -- Invitee and assigned role
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),

  -- Inviter information
  invited_by_user_id TEXT NOT NULL,
  invited_by_email TEXT,

  -- Acceptance token and lifecycle
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for msp_invitations
CREATE INDEX IF NOT EXISTS idx_msp_invitations_org ON msp_invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_msp_invitations_token ON msp_invitations(token);
CREATE INDEX IF NOT EXISTS idx_msp_invitations_email ON msp_invitations(email);

-- Row Level Security (service-role-only passthrough, matching other msp_* tables)
ALTER TABLE msp_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to msp_invitations" ON msp_invitations;
CREATE POLICY "Service role has full access to msp_invitations"
ON msp_invitations
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- Access mode columns
-- ============================================
-- 'full' members can operate on every managed tenant including the MSP's
-- primary tenant. 'customer_only' members are restricted to customer tenants.

ALTER TABLE msp_user_memberships
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'full';

ALTER TABLE msp_invitations
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'full';

-- Allowed values
ALTER TABLE msp_user_memberships
  DROP CONSTRAINT IF EXISTS msp_user_memberships_access_mode_check;
ALTER TABLE msp_user_memberships
  ADD CONSTRAINT msp_user_memberships_access_mode_check
  CHECK (access_mode IN ('full', 'customer_only'));

ALTER TABLE msp_invitations
  DROP CONSTRAINT IF EXISTS msp_invitations_access_mode_check;
ALTER TABLE msp_invitations
  ADD CONSTRAINT msp_invitations_access_mode_check
  CHECK (access_mode IN ('full', 'customer_only'));

-- Owners always retain full access. role::text keeps this working whether the
-- role column is the msp_role enum (production) or TEXT (defensive create).
ALTER TABLE msp_user_memberships
  DROP CONSTRAINT IF EXISTS msp_user_memberships_owner_full_access_check;
ALTER TABLE msp_user_memberships
  ADD CONSTRAINT msp_user_memberships_owner_full_access_check
  CHECK (role::text != 'owner' OR access_mode = 'full');
