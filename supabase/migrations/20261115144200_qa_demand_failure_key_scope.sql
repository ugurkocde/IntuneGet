-- Restrict failure aggregation without changing existing function settings.
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $preserve$
DECLARE existing_config text[];
BEGIN
 SELECT proconfig INTO existing_config FROM pg_proc
 WHERE oid='public.qa_missing_demand_backfill_ids(integer)'::regprocedure
 AND md5(prosrc)='a3942a7adb1935a6ab8213bc01b5c36c';
 IF NOT FOUND OR existing_config IS NULL OR NOT (existing_config=ARRAY['search_path=""'] OR
   (cardinality(existing_config)=2 AND existing_config @> ARRAY['search_path=""','statement_timeout=2s'])) THEN
   RAISE EXCEPTION 'Demand function source or configuration changed; review before activation';
 END IF;
 EXECUTE $definition$
create or replace function public.qa_missing_demand_backfill_ids(
  p_limit integer default 3
)
returns table(winget_id text)
language sql
stable
security definer
set search_path = ''
as $$
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
$$;
 $definition$;
 IF 'statement_timeout=2s'=ANY(existing_config) THEN
   ALTER FUNCTION public.qa_missing_demand_backfill_ids(integer) SET statement_timeout='2s';
 END IF;
END $preserve$;
NOTIFY pgrst, 'reload schema';
