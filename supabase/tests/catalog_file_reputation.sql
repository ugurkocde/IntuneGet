BEGIN;
DO $$
DECLARE h text; before_count integer;
BEGIN
  IF has_function_privilege('anon','public.request_catalog_file_reputation(text[],boolean)','execute')
    OR has_function_privilege('authenticated','public.request_catalog_file_reputation(text[],boolean)','execute') THEN
    RAISE EXCEPTION 'Public roles can queue lookups';
  END IF;
  IF NOT has_function_privilege('service_role','public.request_catalog_file_reputation(text[],boolean)','execute') THEN
    RAISE EXCEPTION 'Service cannot queue lookups';
  END IF;
  SELECT lower(installer_sha256) INTO h FROM public.version_history WHERE installer_sha256 ~* '^[a-f0-9]{64}$' LIMIT 1;
  DELETE FROM public.catalog_file_reputation WHERE sha256 = h;
  PERFORM public.request_catalog_file_reputation(ARRAY[h]);
  IF NOT EXISTS (SELECT 1 FROM public.catalog_file_reputation WHERE sha256=h AND status='pending' AND priority=1) THEN
    RAISE EXCEPTION 'Known catalog hash not queued';
  END IF;
  UPDATE public.catalog_file_reputation SET status='found', malicious=2,suspicious=1,total_engines=72 WHERE sha256=h;
  PERFORM public.request_catalog_file_reputation(ARRAY[h]);
  IF NOT EXISTS (SELECT 1 FROM public.catalog_file_reputation WHERE sha256=h AND malicious=2 AND status='found') THEN
    RAISE EXCEPTION 'Queue changed recorded findings';
  END IF;
  SELECT count(*) INTO before_count FROM public.catalog_file_reputation;
  PERFORM public.request_catalog_file_reputation(ARRAY['invalid',repeat('0',64)]);
  IF (SELECT count(*) FROM public.catalog_file_reputation) <> before_count THEN
    RAISE EXCEPTION 'Unknown hashes entered queue';
  END IF;
END $$;
SET LOCAL ROLE anon;
SELECT count(*) FROM public.catalog_file_reputation;
RESET ROLE;
ROLLBACK;
