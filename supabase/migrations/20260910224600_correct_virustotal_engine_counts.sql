-- Legacy aggregates included engines that did not return a verdict.
-- Preserve findings and timestamps; do not invent corrected denominators.
ALTER TABLE public.catalog_file_reputation ADD COLUMN engine_count_version smallint NOT NULL DEFAULT 1;
ALTER TABLE public.catalog_file_reputation DROP CONSTRAINT catalog_file_reputation_check;
ALTER TABLE public.catalog_file_reputation ADD CONSTRAINT catalog_file_reputation_check CHECK (
  status <> 'found' OR (malicious IS NOT NULL AND suspicious IS NOT NULL AND
    ((engine_count_version=1 AND total_engines IS NULL) OR
     (engine_count_version=2 AND total_engines IS NOT NULL AND malicious+suspicious<=total_engines)))
) NOT VALID;
UPDATE public.catalog_file_reputation SET total_engines=NULL;
ALTER TABLE public.catalog_file_reputation VALIDATE CONSTRAINT catalog_file_reputation_check;
UPDATE public.qa_results SET virustotal_total_engines=NULL WHERE virustotal_total_engines IS NOT NULL;
UPDATE public.qa_package_results SET virustotal_total_engines=NULL WHERE virustotal_total_engines IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_catalog_engine_count() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.engine_count_version <> 2 THEN NEW.total_engines := NULL; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_catalog_engine_count() FROM PUBLIC;
CREATE TRIGGER guard_catalog_engine_count BEFORE INSERT OR UPDATE ON public.catalog_file_reputation
FOR EACH ROW EXECUTE FUNCTION public.guard_catalog_engine_count();

CREATE OR REPLACE FUNCTION public.cache_qa_file_reputation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.installer_sha256 ~* '^[a-f0-9]{64}$' AND NEW.virustotal_status IN ('clean','flagged','suspicious')
    AND NEW.virustotal_malicious>=0 AND NEW.virustotal_suspicious>=0 THEN
    INSERT INTO public.catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,analyzed_at,checked_at,retry_after,engine_count_version)
    VALUES(lower(NEW.installer_sha256),'found',NEW.virustotal_malicious,NEW.virustotal_suspicious,NULL,
      NEW.virustotal_scanned_at_utc,NEW.tested_at_utc,coalesce(NEW.tested_at_utc,now())+interval '7 days',1)
    ON CONFLICT(sha256) DO UPDATE SET status='found',malicious=excluded.malicious,suspicious=excluded.suspicious,
      total_engines=CASE WHEN public.catalog_file_reputation.analyzed_at=excluded.analyzed_at THEN public.catalog_file_reputation.total_engines ELSE NULL END,
      engine_count_version=CASE WHEN public.catalog_file_reputation.analyzed_at=excluded.analyzed_at THEN public.catalog_file_reputation.engine_count_version ELSE 1 END,analyzed_at=excluded.analyzed_at,checked_at=excluded.checked_at,
      retry_after=excluded.retry_after,queued_at=NULL,priority=0,lease_token=NULL,lease_expires_at=NULL,attempts=0
    WHERE public.catalog_file_reputation.status<>'found' OR
      (excluded.analyzed_at>=coalesce(public.catalog_file_reputation.analyzed_at,'-infinity'::timestamptz)
       AND excluded.checked_at>=coalesce(public.catalog_file_reputation.checked_at,'-infinity'::timestamptz));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cache_qa_file_reputation() FROM PUBLIC,anon,authenticated;
