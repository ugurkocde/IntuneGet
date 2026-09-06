-- Only hashes recorded within the rolling last 72 hours may consume catalog lookup quota.
-- Keep cached evidence and manual report links for older versions.
CREATE INDEX IF NOT EXISTS idx_version_history_hash_recorded ON public.version_history(lower(installer_sha256),created_at);

CREATE OR REPLACE FUNCTION public.request_catalog_file_reputation(hashes text[], prioritized boolean DEFAULT true)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  INSERT INTO public.catalog_file_reputation(sha256,priority,queued_at)
  SELECT DISTINCT lower(h), CASE WHEN prioritized THEN 2 ELSE 0 END,now()
  FROM unnest(hashes[1:40]) AS h
  WHERE h ~* '^[a-f0-9]{64}$' AND EXISTS(SELECT 1 FROM public.version_history v WHERE lower(v.installer_sha256)=lower(h) AND v.created_at>=now()-interval '72 hours' AND v.created_at<=now())
  ON CONFLICT(sha256) DO UPDATE SET
    queued_at=coalesce(public.catalog_file_reputation.queued_at,now()),
    requested_at=CASE WHEN public.catalog_file_reputation.queued_at IS NULL THEN now() ELSE public.catalog_file_reputation.requested_at END,
    priority=greatest(public.catalog_file_reputation.priority,
      CASE WHEN public.catalog_file_reputation.status IN ('found','not_found') THEN CASE WHEN prioritized THEN 1 ELSE 0 END ELSE excluded.priority END)
  WHERE public.catalog_file_reputation.retry_after<=now();
$$;

CREATE OR REPLACE FUNCTION public.enqueue_new_catalog_hash() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.installer_sha256 ~* '^[a-f0-9]{64}$' AND NEW.created_at>=now()-interval '72 hours' AND NEW.created_at<=now() THEN
    INSERT INTO public.catalog_file_reputation(sha256,priority,queued_at)
    VALUES(lower(NEW.installer_sha256),2,now())
    ON CONFLICT(sha256) DO UPDATE SET queued_at=coalesce(public.catalog_file_reputation.queued_at,now()),
      priority=greatest(public.catalog_file_reputation.priority,2)
    WHERE public.catalog_file_reputation.status<>'found' AND public.catalog_file_reputation.retry_after<=now();
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.claim_catalog_file_reputation() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE budget public.catalog_reputation_budget%ROWTYPE; item public.catalog_file_reputation%ROWTYPE; today date=(now() AT TIME ZONE 'UTC')::date;
BEGIN
  UPDATE public.catalog_file_reputation r SET queued_at=NULL,lease_token=NULL,lease_expires_at=NULL,priority=0
  WHERE queued_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.version_history v WHERE lower(v.installer_sha256)=r.sha256
      AND v.created_at>=now()-interval '72 hours' AND v.created_at<=now()
  );
  SELECT * INTO budget FROM public.catalog_reputation_budget WHERE singleton FOR UPDATE;
  IF budget.utc_day<>today THEN
    UPDATE public.catalog_reputation_budget SET utc_day=today,requests=0,backfill_requests=0 WHERE singleton RETURNING * INTO budget;
  END IF;
  IF budget.requests>=400 THEN RETURN jsonb_build_object('stop','daily_budget'); END IF;
  IF budget.paused_until>now() THEN RETURN jsonb_build_object('stop','rate_limit','retry_at',budget.paused_until); END IF;
  IF budget.next_request_at>now() THEN
    RETURN jsonb_build_object('wait_ms',ceil(extract(epoch FROM budget.next_request_at-now())*1000));
  END IF;
  SELECT * INTO item FROM public.catalog_file_reputation r
  WHERE EXISTS (SELECT 1 FROM public.version_history v WHERE lower(v.installer_sha256)=r.sha256 AND v.created_at>=now()-interval '72 hours' AND v.created_at<=now())
    AND queued_at IS NOT NULL AND retry_after<=now() AND (lease_expires_at IS NULL OR lease_expires_at<=now())
    AND (priority=2 OR budget.backfill_requests<200)
  ORDER BY priority DESC,queued_at,sha256 LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('stop','no_eligible_work'); END IF;
  UPDATE public.catalog_reputation_budget SET requests=requests+1,backfill_requests=backfill_requests+CASE WHEN item.priority<2 THEN 1 ELSE 0 END,
    next_request_at=now()+interval '20 seconds' WHERE singleton;
  UPDATE public.catalog_file_reputation SET lease_token=gen_random_uuid(),lease_expires_at=now()+interval '15 minutes',attempts=attempts+1
    WHERE sha256=item.sha256 RETURNING * INTO item;
  RETURN jsonb_build_object('report',to_jsonb(item),'remaining_today',399-budget.requests);
END $$;

CREATE OR REPLACE FUNCTION public.catalog_file_reputation_queue_stats() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('queued',count(*) FILTER(WHERE queued_at IS NOT NULL),
    'unseen',count(*) FILTER(WHERE queued_at IS NOT NULL AND status<>'found'),
    'backfill',count(*) FILTER(WHERE queued_at IS NOT NULL AND priority=0),
    'oldest_queued_at',min(queued_at),
    'requests_today',(SELECT CASE WHEN utc_day=(now() AT TIME ZONE 'UTC')::date THEN requests ELSE 0 END FROM public.catalog_reputation_budget WHERE singleton),
    'backfill_requests_today',(SELECT CASE WHEN utc_day=(now() AT TIME ZONE 'UTC')::date THEN backfill_requests ELSE 0 END FROM public.catalog_reputation_budget WHERE singleton),
    'daily_budget',400,'backfill_budget',200)
  FROM public.catalog_file_reputation r WHERE EXISTS (SELECT 1 FROM public.version_history v WHERE lower(v.installer_sha256)=r.sha256 AND v.created_at>=now()-interval '72 hours' AND v.created_at<=now());
$$;
REVOKE ALL ON FUNCTION public.catalog_file_reputation_queue_stats() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_file_reputation_queue_stats() TO service_role;

-- Remove the existing historical backlog without deleting cached reports.
UPDATE public.catalog_file_reputation r SET queued_at=NULL,lease_token=NULL,lease_expires_at=NULL,priority=0
  WHERE queued_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.version_history v WHERE lower(v.installer_sha256)=r.sha256
      AND v.created_at>=now()-interval '72 hours' AND v.created_at<=now()
  );
