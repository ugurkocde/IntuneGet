-- Reserve half the catalog budget for unseen releases and requested files.
-- Cached refreshes outrank historical backfill, sharing its 200-request budget.
UPDATE public.catalog_file_reputation SET priority=0 WHERE queued_at IS NULL;
UPDATE public.catalog_file_reputation SET priority=2 WHERE priority=1 AND status IN ('pending','error');

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
      CASE WHEN public.catalog_file_reputation.status IN ('found','not_found') THEN CASE WHEN prioritized THEN 1 ELSE 0 END ELSE excluded.priority END)
  WHERE public.catalog_file_reputation.retry_after<=now();
$$;

CREATE OR REPLACE FUNCTION public.enqueue_new_catalog_hash() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.installer_sha256 ~* '^[a-f0-9]{64}$' THEN
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
    AND (priority=2 OR budget.backfill_requests<200)
  ORDER BY priority DESC,queued_at,sha256 LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('stop','no_eligible_work'); END IF;
  UPDATE public.catalog_reputation_budget SET requests=requests+1,backfill_requests=backfill_requests+CASE WHEN item.priority<2 THEN 1 ELSE 0 END,
    next_request_at=now()+interval '20 seconds' WHERE singleton;
  UPDATE public.catalog_file_reputation SET lease_token=gen_random_uuid(),lease_expires_at=now()+interval '15 minutes',attempts=attempts+1
    WHERE sha256=item.sha256 RETURNING * INTO item;
  RETURN jsonb_build_object('report',to_jsonb(item),'remaining_today',399-budget.requests);
END $$;
