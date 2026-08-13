-- IntuneGet: User Profiles Schema
-- Stores Microsoft identity details and tokens used by server-side authentication.

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  microsoft_access_token TEXT,
  microsoft_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  intune_tenant_id TEXT,
  tenant_name TEXT,
  profile_image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to user_profiles" ON user_profiles;

CREATE POLICY "Service role has full access to user_profiles"
ON user_profiles
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_user_profiles_updated_at();
