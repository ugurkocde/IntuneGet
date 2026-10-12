BEGIN;
INSERT INTO public.curated_apps(winget_id,name,publisher,latest_version)
VALUES('IntuneGet.RecentReputationFixture','Recent Reputation Fixture','IntuneGet','1.0');
INSERT INTO public.version_history(winget_id,version,installer_sha256,created_at)
VALUES
 ('IntuneGet.RecentReputationFixture','old',repeat('3',64),now()-interval '72 hours 1 second'),
 ('IntuneGet.RecentReputationFixture','boundary',repeat('4',64),now()-interval '72 hours'),
 ('IntuneGet.RecentReputationFixture','recent',repeat('5',64),now()-interval '1 hour');
DO $$ BEGIN
  PERFORM public.request_catalog_file_reputation(ARRAY[repeat('3',64),repeat('4',64),repeat('5',64)]);
  IF EXISTS(SELECT 1 FROM public.catalog_file_reputation WHERE sha256 IN (repeat('3',64),repeat('4',64),repeat('5',64)) AND queued_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Recent or historical versions queued retired catalog lookups';
  END IF;
END $$;
ROLLBACK;
