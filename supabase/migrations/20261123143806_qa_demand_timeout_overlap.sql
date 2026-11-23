-- Bound optional demand work and skip overlapping transactions before any scan.
-- PostgREST must hoist statement_timeout before the request statement starts.
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $guard$
DECLARE cfg text[];
BEGIN
 SELECT proconfig INTO cfg FROM pg_catalog.pg_proc
 WHERE oid='public.qa_missing_demand_backfill_ids(integer)'::regprocedure
 AND md5(prosrc)='e358c88ca1ad6f6fcd0ee5d51b96840b'
 AND prosecdef AND provolatile='s'
 AND prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql');
 IF NOT FOUND OR cfg IS NULL OR NOT (cfg=ARRAY['search_path=""'] OR
 (cardinality(cfg)=2 AND cfg @> ARRAY['search_path=""','statement_timeout=2s'])) THEN
 RAISE EXCEPTION 'Demand function source or configuration changed; review before activation';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.qa_missing_demand_backfill_ids(p_limit integer DEFAULT 3)
RETURNS TABLE(winget_id text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=''
SET statement_timeout='2s'
AS $function$
BEGIN
 -- Transaction-scoped, nonblocking, and confined to this optional RPC.
 IF NOT pg_catalog.pg_try_advisory_xact_lock(1849,1) THEN
   RETURN;
 END IF;
 RETURN QUERY
  with deployed as (
    select
      history.winget_id,
      max(history.deployed_at) as last_deployed_at
    from public.upload_history as history
    where nullif(btrim(history.winget_id), '') is not null
    group by history.winget_id
  ),
  demand as (
    select
      deployed.winget_id,
      exists (
        select 1
        from public.app_update_policies as policy
        where policy.winget_id = deployed.winget_id
          and policy.policy_type = 'auto_update'
          and policy.is_enabled is true
      ) as has_auto_update,
      deployed.last_deployed_at as last_demanded_at
    from deployed
  ),
  current_version_failures as (
    select
      candidate.winget_id,
      max(candidate.finished_at) as last_failed_at
    from public.qa_candidates as candidate
    join demand as demanded on demanded.winget_id = candidate.winget_id
    join public.curated_apps as current_app
      on current_app.winget_id = candidate.winget_id
     and (
       candidate.version = current_app.latest_version
       or candidate.catalog_version_at_enqueue = current_app.latest_version
     )
    where candidate.test_level = 'psadt-package'
      and candidate.status in ('failed', 'error')
    group by candidate.winget_id
  )
  select app.winget_id
  from demand
  join public.curated_apps as app on app.winget_id = demand.winget_id
  left join current_version_failures as failure
    on failure.winget_id = app.winget_id
  where app.is_verified is true
    and app.is_winget_verified is true
    and app.app_source = 'win32'
    and app.is_locale_variant is false
    and nullif(btrim(app.latest_version), '') is not null
    and not exists (
      select 1
      from public.package_eligibility_blocks as eligibility_block
      where eligibility_block.winget_id = app.winget_id
    )
    and not exists (
      select 1
      from public.qa_candidates as candidate
      where candidate.winget_id = app.winget_id
        and (
          candidate.version = app.latest_version
          or candidate.catalog_version_at_enqueue = app.latest_version
        )
        and candidate.test_level = 'psadt-package'
        and candidate.status <> 'superseded'
        and candidate.test_config @> '{"profileKind":"catalog-default"}'::jsonb
    )
    and not exists (
      select 1
      from public.qa_package_blocks as block
      where block.winget_id = app.winget_id
        and block.version = app.latest_version
    )
    and not exists (
      select 1
      from public.qa_catalog_reconciliations as reconciliation
      join public.qa_winget_poll_state as poll_state
        on poll_state.id = 'microsoft/winget-pkgs'
       and poll_state.head_sha = reconciliation.observed_head_sha
      where reconciliation.winget_id = app.winget_id
        and reconciliation.catalog_version = app.latest_version
    )
  order by
    failure.last_failed_at desc nulls last,
    demand.has_auto_update desc,
    demand.last_demanded_at desc nulls last,
    app.winget_id asc
  limit greatest(1, least(coalesce(p_limit, 3), 100));
END;
$function$;
NOTIFY pgrst, 'reload schema';
