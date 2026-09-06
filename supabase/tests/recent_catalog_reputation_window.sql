BEGIN;
INSERT INTO public.curated_apps(winget_id,name,publisher,latest_version)
VALUES('IntuneGet.RecentReputationFixture','Recent Reputation Fixture','IntuneGet','1.0');
INSERT INTO public.version_history(winget_id,version,installer_sha256,created_at)
VALUES
 ('IntuneGet.RecentReputationFixture','old',repeat('3',64),now()-interval '72 hours 1 second'),
 ('IntuneGet.RecentReputationFixture','boundary',repeat('4',64),now()-interval '72 hours'),
 ('IntuneGet.RecentReputationFixture','recent',repeat('5',64),now()-interval '1 hour');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.catalog_file_reputation WHERE sha256=repeat('3',64)) THEN RAISE EXCEPTION 'Old insertion queued'; END IF;
 IF (SELECT count(*) FROM public.catalog_file_reputation WHERE sha256 IN(repeat('4',64),repeat('5',64)) AND queued_at IS NOT NULL)<>2 THEN RAISE EXCEPTION 'Boundary/recent insertion not queued'; END IF;
 PERFORM public.request_catalog_file_reputation(ARRAY[repeat('3',64)],true);
 IF EXISTS(SELECT 1 FROM public.catalog_file_reputation WHERE sha256=repeat('3',64)) THEN RAISE EXCEPTION 'Old page request queued'; END IF;
END $$;
-- Simulate work that aged out while waiting and retain existing cached findings.
INSERT INTO public.catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,queued_at,priority,lease_token,lease_expires_at)
VALUES(repeat('3',64),'found',1,0,75,'1990-01-01',2,gen_random_uuid(),now()-interval '1 second');
UPDATE public.catalog_file_reputation SET queued_at='2000-01-01' WHERE sha256=repeat('4',64);
UPDATE public.catalog_reputation_budget SET utc_day=(now() AT TIME ZONE 'UTC')::date,requests=0,backfill_requests=0,next_request_at=now()-interval '1 second',paused_until=NULL;
DO $$ DECLARE claimed jsonb; BEGIN
 claimed=public.claim_catalog_file_reputation();
 IF claimed->'report'->>'sha256' IS DISTINCT FROM repeat('4',64) THEN RAISE EXCEPTION 'Claim did not reject aged-out work: %',claimed; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.catalog_file_reputation WHERE sha256=repeat('3',64) AND queued_at IS NULL AND lease_token IS NULL AND status='found' AND malicious=1) THEN RAISE EXCEPTION 'Old lease not removed or evidence lost'; END IF;
 IF (SELECT requests FROM public.catalog_reputation_budget)<>1 THEN RAISE EXCEPTION 'Pruning consumed quota'; END IF;
END $$;
-- The same hash can legitimately recur in a newly recorded version.
UPDATE public.catalog_file_reputation SET retry_after=now()-interval '1 second' WHERE sha256=repeat('3',64);
INSERT INTO public.version_history(winget_id,version,installer_sha256,created_at)
VALUES('IntuneGet.RecentReputationFixture','shared',repeat('3',64),now());
SELECT public.request_catalog_file_reputation(ARRAY[repeat('3',64)],true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.catalog_file_reputation WHERE sha256=repeat('3',64) AND queued_at IS NOT NULL) THEN RAISE EXCEPTION 'Shared recent hash was excluded'; END IF;
END $$;
ROLLBACK;
