ALTER TABLE public.version_history
  ADD COLUMN IF NOT EXISTS release_notes_url text,
  ADD COLUMN IF NOT EXISTS release_notes_url_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_version_history_installer_hash
  ON public.version_history(lower(installer_sha256)) WHERE installer_sha256 IS NOT NULL;

CREATE TABLE public.catalog_file_reputation (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'found', 'not_found', 'error')),
  malicious integer CHECK (malicious >= 0),
  suspicious integer CHECK (suspicious >= 0),
  total_engines integer CHECK (total_engines > 0),
  analyzed_at timestamptz,
  checked_at timestamptz,
  retry_after timestamptz NOT NULL DEFAULT now(),
  requested_at timestamptz NOT NULL DEFAULT now(),
  priority integer NOT NULL DEFAULT 0 CHECK (priority IN (0, 1)),
  CHECK (status <> 'found' OR (malicious IS NOT NULL AND suspicious IS NOT NULL AND total_engines IS NOT NULL AND malicious + suspicious <= total_engines))
);
ALTER TABLE public.catalog_file_reputation ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.catalog_file_reputation TO anon, authenticated;
GRANT ALL ON public.catalog_file_reputation TO service_role;
CREATE POLICY "Public installer reputation is readable" ON public.catalog_file_reputation
  FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX idx_catalog_reputation_queue ON public.catalog_file_reputation(priority DESC, requested_at DESC) INCLUDE (retry_after);

-- A file hash identifies the same file across apps and versions. Reuse existing
-- VirusTotal evidence without requiring a new installation or QA run.
INSERT INTO public.catalog_file_reputation (sha256, status, malicious, suspicious, total_engines, analyzed_at, checked_at, retry_after)
SELECT DISTINCT ON (lower(installer_sha256)) lower(installer_sha256),
  'found', virustotal_malicious, virustotal_suspicious, virustotal_total_engines,
  virustotal_scanned_at_utc, NULL, now()
FROM (
  SELECT installer_sha256, virustotal_status, virustotal_malicious, virustotal_suspicious, virustotal_total_engines, virustotal_scanned_at_utc FROM public.qa_results
  UNION ALL
  SELECT installer_sha256, virustotal_status, virustotal_malicious, virustotal_suspicious, virustotal_total_engines, virustotal_scanned_at_utc FROM public.qa_package_results
) evidence
WHERE installer_sha256 ~* '^[a-f0-9]{64}$' AND virustotal_status IN ('clean', 'flagged', 'suspicious')
  AND virustotal_malicious >= 0 AND virustotal_suspicious >= 0
  AND virustotal_total_engines > 0 AND virustotal_malicious + virustotal_suspicious <= virustotal_total_engines
ORDER BY lower(installer_sha256), virustotal_scanned_at_utc DESC NULLS LAST;

CREATE OR REPLACE FUNCTION public.request_catalog_file_reputation(hashes text[], prioritized boolean DEFAULT true)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  INSERT INTO public.catalog_file_reputation (sha256, priority)
  SELECT DISTINCT lower(h), CASE WHEN prioritized THEN 1 ELSE 0 END
  FROM unnest(hashes[1:40]) AS h
  WHERE h ~* '^[a-f0-9]{64}$' AND EXISTS (
    SELECT 1 FROM public.version_history v WHERE lower(v.installer_sha256) = lower(h)
  )
  ON CONFLICT (sha256) DO UPDATE
  SET requested_at = now(), priority = greatest(public.catalog_file_reputation.priority, excluded.priority)
  WHERE public.catalog_file_reputation.retry_after <= now();
$$;
REVOKE ALL ON FUNCTION public.request_catalog_file_reputation(text[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_catalog_file_reputation(text[], boolean) TO service_role;
