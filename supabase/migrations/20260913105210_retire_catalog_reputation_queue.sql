-- Public release history consumes cached evidence and direct report links only.
-- Keep QA cache write-through and all existing reports intact.
DROP TRIGGER IF EXISTS enqueue_new_catalog_hash ON public.version_history;

-- Compatibility for older website deployments: accepted requests do no work.
CREATE OR REPLACE FUNCTION public.request_catalog_file_reputation(hashes text[], prioritized boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  RETURN;
END;
$$;

-- Older worker deployments must stop before reserving budget or calling VT.
CREATE OR REPLACE FUNCTION public.claim_catalog_file_reputation()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('stop', 'catalog_lookups_disabled');
$$;
