-- A QA candidate records both the curated catalog version observed when it was
-- enqueued and the immutable live WinGet version that was actually packaged.
-- If WinGet advances before curated_apps catches up, the live version can later
-- become the catalog version. Treat that tested version as current coverage so
-- the demand reconciler does not enqueue the same passing payload forever.

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

comment on function public.qa_missing_demand_backfill_ids(integer) is
  'Returns customer-deployed Win32 apps missing current catalog QA, recognizing either the captured catalog version or the immutable live version actually tested.';

revoke all on function public.qa_missing_demand_backfill_ids(integer)
  from public, anon, authenticated;
grant execute on function public.qa_missing_demand_backfill_ids(integer)
  to service_role;
