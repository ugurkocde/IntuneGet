BEGIN;
DO $$
DECLARE h text; before_count integer;
BEGIN
  IF has_function_privilege('anon','public.request_catalog_file_reputation(text[],boolean)','execute')
    OR has_function_privilege('authenticated','public.request_catalog_file_reputation(text[],boolean)','execute') THEN
    RAISE EXCEPTION 'Public roles can queue lookups';
  END IF;
  IF NOT has_function_privilege('service_role','public.request_catalog_file_reputation(text[],boolean)','execute') THEN
    RAISE EXCEPTION 'Service compatibility RPC is inaccessible';
  END IF;
  SELECT lower(installer_sha256) INTO h FROM public.version_history WHERE installer_sha256 ~* '^[a-f0-9]{64}$' LIMIT 1;
  SELECT count(*) INTO before_count FROM public.catalog_file_reputation;
  PERFORM public.request_catalog_file_reputation(ARRAY[h]);
  IF (SELECT count(*) FROM public.catalog_file_reputation) <> before_count THEN
    RAISE EXCEPTION 'Retired catalog request created work';
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
