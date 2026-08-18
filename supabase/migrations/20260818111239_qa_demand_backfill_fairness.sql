-- Keep unavailable or incompatible demanded apps from monopolizing every
-- bounded reconciliation batch. Selection history is service-only metadata;
-- never-selected apps are considered first, then the least recently selected.
create table public.qa_demand_backfill_selections (
  winget_id text primary key references public.curated_apps(winget_id) on delete cascade,
  last_selected_at timestamptz not null default now()
);

create index qa_demand_backfill_selections_oldest_idx
  on public.qa_demand_backfill_selections(last_selected_at asc, winget_id asc);

comment on table public.qa_demand_backfill_selections is
  'Service-only fairness cursor for bounded customer-demand QA reconciliation.';

alter table public.qa_demand_backfill_selections enable row level security;
revoke all on table public.qa_demand_backfill_selections from public, anon, authenticated;
grant select, insert, update, delete on table public.qa_demand_backfill_selections to service_role;

create or replace function public.record_qa_demand_backfill_selection(
  p_winget_ids text[]
)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.qa_demand_backfill_selections (winget_id, last_selected_at)
  select distinct btrim(candidate_id), statement_timestamp()
  from unnest(coalesce(p_winget_ids, array[]::text[])) as candidate(candidate_id)
  where nullif(btrim(candidate_id), '') is not null
  on conflict (winget_id) do update
  set last_selected_at = excluded.last_selected_at;
$$;

comment on function public.record_qa_demand_backfill_selection(text[]) is
  'Advances the service-only fairness cursor after a bounded demanded-app QA batch is selected.';

revoke all on function public.record_qa_demand_backfill_selection(text[])
  from public, anon, authenticated;
grant execute on function public.record_qa_demand_backfill_selection(text[])
  to service_role;

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
     and current_app.latest_version = candidate.version
    where candidate.test_level = 'psadt-package'
      and candidate.status in ('failed', 'error')
    group by candidate.winget_id
  )
  select app.winget_id
  from demand
  join public.curated_apps as app on app.winget_id = demand.winget_id
  left join current_version_failures as failure
    on failure.winget_id = app.winget_id
  left join public.qa_demand_backfill_selections as selection
    on selection.winget_id = app.winget_id
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
        and candidate.version = app.latest_version
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
  order by
    selection.last_selected_at asc nulls first,
    failure.last_failed_at desc nulls last,
    demand.has_auto_update desc,
    demand.last_demanded_at desc nulls last,
    app.winget_id asc
  limit greatest(1, least(coalesce(p_limit, 3), 100));
$$;

comment on function public.qa_missing_demand_backfill_ids(integer) is
  'Returns a fair bounded batch of customer-deployed Win32 apps missing current-version QA, excluding application- and version-level compatibility blocks.';

revoke all on function public.qa_missing_demand_backfill_ids(integer)
  from public, anon, authenticated;
grant execute on function public.qa_missing_demand_backfill_ids(integer)
  to service_role;
