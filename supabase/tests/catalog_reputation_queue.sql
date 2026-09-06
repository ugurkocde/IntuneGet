BEGIN;
INSERT INTO public.curated_apps(winget_id,name,publisher,latest_version)
VALUES('IntuneGet.ReputationFixture','Reputation Fixture','IntuneGet','1.0');
INSERT INTO public.version_history(winget_id,version,installer_sha256)
VALUES('IntuneGet.ReputationFixture','1.0',repeat('1',64)),('IntuneGet.ReputationFixture','2.0',repeat('2',64));
DO $$
DECLARE claimed jsonb; original_queue timestamptz; calls integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.catalog_file_reputation WHERE sha256=repeat('1',64) AND priority=2 AND queued_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Manifest insertion did not queue a new hash';
  END IF;
  UPDATE public.catalog_file_reputation SET queued_at='2000-01-01',requested_at='2000-01-01' WHERE sha256=repeat('1',64);
  PERFORM public.request_catalog_file_reputation(ARRAY[repeat('1',64)],true);
  PERFORM public.request_catalog_file_reputation(ARRAY[repeat('1',64)],false);
  IF NOT EXISTS(SELECT 1 FROM public.catalog_file_reputation WHERE sha256=repeat('1',64) AND priority=2 AND queued_at='2000-01-01') THEN
    RAISE EXCEPTION 'Repeated discovery changed ordering or priority';
  END IF;
  UPDATE public.catalog_reputation_budget SET utc_day=(now() AT TIME ZONE 'UTC')::date,requests=0,backfill_requests=0,next_request_at=now()-interval '1 second',paused_until=NULL;
  claimed=public.claim_catalog_file_reputation();
  IF claimed->'report'->>'sha256' IS DISTINCT FROM repeat('1',64) OR claimed->'report'->>'lease_token' IS NULL THEN
    RAISE EXCEPTION 'Oldest prioritized report was not leased: %',claimed;
  END IF;
  claimed=public.claim_catalog_file_reputation();
  IF (claimed->>'wait_ms')::numeric IS NULL OR (claimed->>'wait_ms')::numeric<=0 THEN RAISE EXCEPTION 'Rate interval not enforced'; END IF;
  UPDATE public.catalog_reputation_budget SET next_request_at=now()-interval '1 second';
  claimed=public.claim_catalog_file_reputation();
  IF claimed->'report'->>'sha256'=repeat('1',64) THEN RAISE EXCEPTION 'Active lease was claimed twice'; END IF;
  UPDATE public.catalog_file_reputation SET lease_expires_at=now()-interval '1 second' WHERE sha256=repeat('1',64);
  UPDATE public.catalog_reputation_budget SET next_request_at=now()-interval '1 second';
  claimed=public.claim_catalog_file_reputation();
  IF claimed->'report'->>'sha256' IS DISTINCT FROM repeat('1',64) THEN RAISE EXCEPTION 'Expired lease did not recover'; END IF;
  UPDATE public.catalog_reputation_budget SET requests=400,next_request_at=now()-interval '1 second';
  IF public.claim_catalog_file_reputation()->>'stop' IS DISTINCT FROM 'daily_budget' THEN RAISE EXCEPTION 'Daily budget was exceeded'; END IF;
  UPDATE public.catalog_reputation_budget SET utc_day=(now() AT TIME ZONE 'UTC')::date-1;
  PERFORM public.claim_catalog_file_reputation();
  SELECT requests INTO calls FROM public.catalog_reputation_budget;
  IF calls>1 THEN RAISE EXCEPTION 'UTC daily budget did not reset'; END IF;
  PERFORM public.pause_catalog_file_reputation(120);
  IF public.claim_catalog_file_reputation()->>'stop' IS DISTINCT FROM 'rate_limit' THEN RAISE EXCEPTION 'Provider cooldown not enforced'; END IF;
  UPDATE public.catalog_reputation_budget SET paused_until=NULL,next_request_at=now()-interval '1 second',backfill_requests=200;
  claimed=public.claim_catalog_file_reputation();
  IF (claimed->'report'->>'priority')::integer<2 THEN RAISE EXCEPTION 'Backfill used reserved new-release capacity'; END IF;
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
