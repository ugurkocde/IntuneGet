-- Gradually fill the latest-version QA gap for apps with real customer demand.
-- The scheduler consumes only a few rows per poll so the single VM is not
-- flooded, while customer-triggered deployment tests retain queue priority.

alter table public.qa_poll_runs
  add column if not exists demand_backfill_requested_count integer not null default 0
    check (demand_backfill_requested_count >= 0),
  add column if not exists demand_backfill_count integer not null default 0
    check (demand_backfill_count >= 0);

comment on column public.qa_poll_runs.demand_backfill_requested_count is
  'Number of demanded apps missing latest-version catalog QA selected for this poll.';
comment on column public.qa_poll_runs.demand_backfill_count is
  'Number of selected demanded-app backfills that remained eligible after catalog filtering.';

create index if not exists qa_candidates_current_catalog_profile_idx
  on public.qa_candidates(winget_id, version)
  where test_level = 'psadt-package'
    and status <> 'superseded'
    and test_config @> '{"profileKind":"catalog-default"}'::jsonb;

create or replace function public.qa_missing_demand_backfill_ids(
  p_limit integer default 3
)
returns table(winget_id text)
language sql
stable
security definer
set search_path = ''
as $$
  with demand_events as (
    select
      history.winget_id,
      false as has_auto_update,
      history.deployed_at as demanded_at
    from public.upload_history as history
    where nullif(btrim(history.winget_id), '') is not null

    union all

    select
      policy.winget_id,
      true as has_auto_update,
      policy.updated_at as demanded_at
    from public.app_update_policies as policy
    where policy.policy_type = 'auto_update'
      and policy.is_enabled is true
      and nullif(btrim(policy.winget_id), '') is not null
  ),
  demand as (
    select
      event.winget_id,
      bool_or(event.has_auto_update) as has_auto_update,
      max(event.demanded_at) as last_demanded_at
    from demand_events as event
    group by event.winget_id
  )
  select app.winget_id
  from demand
  join public.curated_apps as app on app.winget_id = demand.winget_id
  where app.is_verified is true
    and app.is_winget_verified is true
    and app.app_source = 'win32'
    and app.is_locale_variant is false
    and nullif(btrim(app.latest_version), '') is not null
    and not exists (
      select 1
      from public.qa_candidates as candidate
      where candidate.winget_id = app.winget_id
        and candidate.version = app.latest_version
        and candidate.test_level = 'psadt-package'
        and candidate.status <> 'superseded'
        and candidate.test_config @> '{"profileKind":"catalog-default"}'::jsonb
    )
  order by
    demand.has_auto_update desc,
    demand.last_demanded_at desc nulls last,
    app.winget_id asc
  limit greatest(1, least(coalesce(p_limit, 3), 100));
$$;

comment on function public.qa_missing_demand_backfill_ids(integer) is
  'Returns a bounded service-only batch of demanded Win32 apps missing catalog QA for the current catalog version.';

revoke all on function public.qa_missing_demand_backfill_ids(integer)
  from public, anon, authenticated;
grant execute on function public.qa_missing_demand_backfill_ids(integer)
  to service_role;
