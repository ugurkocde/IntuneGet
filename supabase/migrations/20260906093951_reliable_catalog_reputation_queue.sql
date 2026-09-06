-- Separate cached evidence from work awaiting a lookup. Reading a fresh report
-- must not schedule a daily rescan or change another request's place in line.
ALTER TABLE public.catalog_file_reputation
  DROP CONSTRAINT catalog_file_reputation_priority_check,
  ADD CONSTRAINT catalog_file_reputation_priority_check CHECK (priority BETWEEN 0 AND 2),
  ADD COLUMN queued_at timestamptz,
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0);
UPDATE public.catalog_file_reputation SET
  queued_at = CASE WHEN status IN ('pending','error') THEN requested_at ELSE NULL END,
  priority = CASE WHEN priority = 1 THEN 2 ELSE 0 END,
  retry_after = CASE WHEN status='found' THEN coalesce(checked_at,now()) + interval '7 days' ELSE retry_after END;
CREATE INDEX idx_catalog_reputation_pending ON public.catalog_file_reputation(priority DESC,queued_at,sha256)
  WHERE queued_at IS NOT NULL;

CREATE TABLE public.catalog_reputation_budget (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  utc_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  backfill_requests integer NOT NULL DEFAULT 0 CHECK (backfill_requests >= 0),
  next_request_at timestamptz NOT NULL DEFAULT now(),
  paused_until timestamptz
);
ALTER TABLE public.catalog_reputation_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_reputation_budget FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.catalog_reputation_budget TO service_role;
INSERT INTO public.catalog_reputation_budget(singleton,requests)
SELECT true,least(400,count(*))::integer FROM public.catalog_file_reputation WHERE checked_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

CREATE OR REPLACE FUNCTION public.request_catalog_file_reputation(hashes text[], prioritized boolean DEFAULT true)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  INSERT INTO public.catalog_file_reputation(sha256,priority,queued_at)
  SELECT DISTINCT lower(h), CASE WHEN prioritized THEN 2 ELSE 0 END,now()
  FROM unnest(hashes[1:40]) AS h
  WHERE h ~* '^[a-f0-9]{64}$' AND EXISTS(SELECT 1 FROM public.version_history v WHERE lower(v.installer_sha256)=lower(h))
  ON CONFLICT(sha256) DO UPDATE SET
    queued_at=coalesce(public.catalog_file_reputation.queued_at,now()),
    requested_at=CASE WHEN public.catalog_file_reputation.queued_at IS NULL THEN now() ELSE public.catalog_file_reputation.requested_at END,
    priority=greatest(public.catalog_file_reputation.priority,
      CASE WHEN public.catalog_file_reputation.status='found' THEN 0 ELSE excluded.priority END)
  WHERE public.catalog_file_reputation.retry_after<=now();
$$;
REVOKE ALL ON FUNCTION public.request_catalog_file_reputation(text[],boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_catalog_file_reputation(text[],boolean) TO service_role;

CREATE FUNCTION public.enqueue_new_catalog_hash() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.installer_sha256 ~* '^[a-f0-9]{64}$' THEN
    INSERT INTO public.catalog_file_reputation(sha256,priority,queued_at)
    VALUES(lower(NEW.installer_sha256),1,now())
    ON CONFLICT(sha256) DO UPDATE SET queued_at=coalesce(public.catalog_file_reputation.queued_at,now()),
      priority=greatest(public.catalog_file_reputation.priority,1)
    WHERE public.catalog_file_reputation.status<>'found' AND public.catalog_file_reputation.retry_after<=now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_new_catalog_hash() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER enqueue_new_catalog_hash AFTER INSERT OR UPDATE OF installer_sha256 ON public.version_history
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_new_catalog_hash();

-- Reuse newly synchronized QA evidence continuously, not just during migration.
CREATE FUNCTION public.cache_qa_file_reputation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.installer_sha256 ~* '^[a-f0-9]{64}$' AND NEW.virustotal_status IN ('clean','flagged','suspicious')
    AND NEW.virustotal_malicious>=0 AND NEW.virustotal_suspicious>=0 AND NEW.virustotal_total_engines>0
    AND NEW.virustotal_malicious+NEW.virustotal_suspicious<=NEW.virustotal_total_engines THEN
    INSERT INTO public.catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,analyzed_at,checked_at,retry_after)
    VALUES(lower(NEW.installer_sha256),'found',NEW.virustotal_malicious,NEW.virustotal_suspicious,NEW.virustotal_total_engines,
      NEW.virustotal_scanned_at_utc,NEW.tested_at_utc,coalesce(NEW.tested_at_utc,now())+interval '7 days')
    ON CONFLICT(sha256) DO UPDATE SET status='found',malicious=excluded.malicious,suspicious=excluded.suspicious,
      total_engines=excluded.total_engines,analyzed_at=excluded.analyzed_at,checked_at=excluded.checked_at,
      retry_after=excluded.retry_after,queued_at=NULL,priority=0,lease_token=NULL,lease_expires_at=NULL,attempts=0
    WHERE public.catalog_file_reputation.status<>'found' OR
      (excluded.analyzed_at>=coalesce(public.catalog_file_reputation.analyzed_at,'-infinity'::timestamptz)
       AND excluded.checked_at>=coalesce(public.catalog_file_reputation.checked_at,'-infinity'::timestamptz));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cache_qa_file_reputation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cache_qa_file_reputation AFTER INSERT OR UPDATE OF virustotal_status,virustotal_scanned_at_utc ON public.qa_results
  FOR EACH ROW EXECUTE FUNCTION public.cache_qa_file_reputation();
CREATE TRIGGER cache_qa_package_file_reputation AFTER INSERT OR UPDATE OF virustotal_status,virustotal_scanned_at_utc ON public.qa_package_results
  FOR EACH ROW EXECUTE FUNCTION public.cache_qa_file_reputation();

-- Backfill current catalog versions only. Older history remains demand-driven.
INSERT INTO public.catalog_file_reputation(sha256,priority,queued_at)
SELECT DISTINCT lower(v.installer_sha256),0,now()
FROM public.curated_apps c JOIN public.version_history v ON v.winget_id=c.winget_id AND v.version=c.latest_version
WHERE NOT c.is_locale_variant AND v.installer_sha256 ~* '^[a-f0-9]{64}$'
ON CONFLICT(sha256) DO NOTHING;

CREATE FUNCTION public.claim_catalog_file_reputation() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE budget public.catalog_reputation_budget%ROWTYPE; item public.catalog_file_reputation%ROWTYPE; today date=(now() AT TIME ZONE 'UTC')::date;
BEGIN
  SELECT * INTO budget FROM public.catalog_reputation_budget WHERE singleton FOR UPDATE;
  IF budget.utc_day<>today THEN
    UPDATE public.catalog_reputation_budget SET utc_day=today,requests=0,backfill_requests=0 WHERE singleton RETURNING * INTO budget;
  END IF;
  IF budget.requests>=400 THEN RETURN jsonb_build_object('stop','daily_budget'); END IF;
  IF budget.paused_until>now() THEN RETURN jsonb_build_object('stop','rate_limit','retry_at',budget.paused_until); END IF;
  IF budget.next_request_at>now() THEN
    RETURN jsonb_build_object('wait_ms',ceil(extract(epoch FROM budget.next_request_at-now())*1000));
  END IF;
  SELECT * INTO item FROM public.catalog_file_reputation
  WHERE queued_at IS NOT NULL AND retry_after<=now() AND (lease_expires_at IS NULL OR lease_expires_at<=now())
    AND (priority>0 OR budget.backfill_requests<200)
  ORDER BY priority DESC,queued_at,sha256 LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('stop','no_eligible_work'); END IF;
  UPDATE public.catalog_reputation_budget SET requests=requests+1,backfill_requests=backfill_requests+CASE WHEN item.priority=0 THEN 1 ELSE 0 END,
    next_request_at=now()+interval '20 seconds' WHERE singleton;
  UPDATE public.catalog_file_reputation SET lease_token=gen_random_uuid(),lease_expires_at=now()+interval '15 minutes',attempts=attempts+1
    WHERE sha256=item.sha256 RETURNING * INTO item;
  RETURN jsonb_build_object('report',to_jsonb(item),'remaining_today',399-budget.requests);
END $$;
REVOKE ALL ON FUNCTION public.claim_catalog_file_reputation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_catalog_file_reputation() TO service_role;

CREATE FUNCTION public.pause_catalog_file_reputation(seconds integer) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  UPDATE public.catalog_reputation_budget SET paused_until=greatest(coalesce(paused_until,now()),now()+make_interval(secs=>least(86400,greatest(60,seconds)))) WHERE singleton;
$$;
REVOKE ALL ON FUNCTION public.pause_catalog_file_reputation(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pause_catalog_file_reputation(integer) TO service_role;

CREATE FUNCTION public.catalog_file_reputation_queue_stats() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('queued',count(*) FILTER(WHERE queued_at IS NOT NULL),
    'unseen',count(*) FILTER(WHERE queued_at IS NOT NULL AND status<>'found'),
    'backfill',count(*) FILTER(WHERE queued_at IS NOT NULL AND priority=0),
    'oldest_queued_at',min(queued_at),
    'requests_today',(SELECT CASE WHEN utc_day=(now() AT TIME ZONE 'UTC')::date THEN requests ELSE 0 END FROM public.catalog_reputation_budget WHERE singleton),
    'backfill_requests_today',(SELECT CASE WHEN utc_day=(now() AT TIME ZONE 'UTC')::date THEN backfill_requests ELSE 0 END FROM public.catalog_reputation_budget WHERE singleton),
    'daily_budget',400,'backfill_budget',200)
  FROM public.catalog_file_reputation;
$$;
REVOKE ALL ON FUNCTION public.catalog_file_reputation_queue_stats() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_file_reputation_queue_stats() TO service_role;
