BEGIN;
INSERT INTO public.curated_apps(winget_id,name,publisher,latest_version)
VALUES('IntuneGet.ReputationFixture','Reputation Fixture','IntuneGet','1.0');
INSERT INTO public.version_history(winget_id,version,installer_sha256)
VALUES('IntuneGet.ReputationFixture','1.0',repeat('1',64)),('IntuneGet.ReputationFixture','2.0',repeat('2',64));
DO $$
DECLARE before_budget jsonb;
BEGIN
  IF EXISTS(SELECT 1 FROM public.catalog_file_reputation WHERE sha256 IN (repeat('1',64), repeat('2',64)) AND queued_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Manifest insertion queued a retired catalog lookup';
  END IF;
  SELECT to_jsonb(b) INTO before_budget FROM public.catalog_reputation_budget b;
  IF public.claim_catalog_file_reputation()->>'stop' IS DISTINCT FROM 'catalog_lookups_disabled' THEN
    RAISE EXCEPTION 'Retired worker can claim work';
  END IF;
  IF (SELECT to_jsonb(b) FROM public.catalog_reputation_budget b) IS DISTINCT FROM before_budget THEN
    RAISE EXCEPTION 'Retired worker changed budget';
  END IF;
  IF has_function_privilege('anon','public.claim_catalog_file_reputation()','execute') OR
    has_function_privilege('authenticated','public.pause_catalog_file_reputation(integer)','execute') OR
    has_table_privilege('anon','public.catalog_reputation_budget','select') THEN RAISE EXCEPTION 'Private queue controls exposed'; END IF;
END $$;
-- QA findings satisfy a queued hash, including when a worker held a lease.
UPDATE public.qa_results SET installer_sha256=repeat('1',64),virustotal_status='flagged',virustotal_malicious=2,
  virustotal_suspicious=0,virustotal_total_engines=75,virustotal_scanned_at_utc=now(),tested_at_utc=now()
WHERE winget_id=(SELECT winget_id FROM public.qa_results LIMIT 1);
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.catalog_file_reputation WHERE sha256=repeat('1',64) AND status='found' AND malicious=2 AND queued_at IS NULL AND lease_token IS NULL) THEN
    RAISE EXCEPTION 'QA evidence did not populate cache and satisfy queue';
  END IF;
  PERFORM public.request_catalog_file_reputation(ARRAY[repeat('1',64)],true);
  IF EXISTS(SELECT 1 FROM public.catalog_file_reputation WHERE sha256=repeat('1',64) AND queued_at IS NOT NULL) THEN RAISE EXCEPTION 'Fresh cache result was unnecessarily queued'; END IF;
END $$;
ROLLBACK;
