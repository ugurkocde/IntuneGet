-- Shared, service-only state for installer verification before a packaging
-- workflow is dispatched. The cache key includes the complete trusted tuple,
-- so a corrected URL or SHA256 automatically receives a new health record.
CREATE TABLE IF NOT EXISTS public.installer_health (
  cache_key TEXT PRIMARY KEY,
  winget_id TEXT NOT NULL,
  version TEXT NOT NULL,
  architecture TEXT NOT NULL,
  installer_url TEXT NOT NULL,
  expected_sha256 TEXT NOT NULL CHECK (expected_sha256 ~ '^[A-F0-9]{64}$'),
  actual_sha256 TEXT CHECK (actual_sha256 IS NULL OR actual_sha256 ~ '^[A-F0-9]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('checking', 'healthy', 'quarantined', 'error')),
  reason_code TEXT,
  reason_message TEXT,
  checked_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_installer_health_package
  ON public.installer_health(winget_id, version, architecture);

CREATE INDEX IF NOT EXISTS idx_installer_health_expiry
  ON public.installer_health(expires_at)
  WHERE status IN ('healthy', 'error');

ALTER TABLE public.installer_health ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.installer_health FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.installer_health TO service_role;

-- Atomically claim a stale or previously unclaimed tuple. Quarantined tuples
-- are intentionally never reclaimed. A corrected manifest produces a new key.
CREATE OR REPLACE FUNCTION public.claim_installer_preflight(
  p_cache_key TEXT,
  p_winget_id TEXT,
  p_version TEXT,
  p_architecture TEXT,
  p_installer_url TEXT,
  p_expected_sha256 TEXT,
  p_lease_seconds INTEGER DEFAULT 240
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  affected_rows BIGINT := 0;
BEGIN
  INSERT INTO public.installer_health (
    cache_key,
    winget_id,
    version,
    architecture,
    installer_url,
    expected_sha256,
    status,
    lease_expires_at,
    updated_at
  )
  VALUES (
    p_cache_key,
    p_winget_id,
    p_version,
    p_architecture,
    p_installer_url,
    UPPER(p_expected_sha256),
    'checking',
    NOW() + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 600))),
    NOW()
  )
  ON CONFLICT (cache_key) DO NOTHING;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows > 0 THEN
    RETURN TRUE;
  END IF;

  UPDATE public.installer_health
  SET
    status = 'checking',
    reason_code = NULL,
    reason_message = NULL,
    lease_expires_at = NOW() + make_interval(secs => GREATEST(30, LEAST(p_lease_seconds, 600))),
    updated_at = NOW()
  WHERE cache_key = p_cache_key
    AND status <> 'quarantined'
    AND (
      (status = 'checking' AND lease_expires_at <= NOW())
      OR (status IN ('healthy', 'error') AND COALESCE(expires_at, '-infinity'::TIMESTAMPTZ) <= NOW())
    );

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_installer_preflight(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_installer_preflight(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  TO service_role;

COMMENT ON TABLE public.installer_health IS
  'Service-only installer verification and quarantine state used before GitHub Actions dispatch.';

COMMENT ON FUNCTION public.claim_installer_preflight(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) IS
  'Claims an installer tuple for verification when no fresh result or active lease exists.';
