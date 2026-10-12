-- Avoid repeatedly selecting the same deployed app when the current WinGet
-- repository head cannot provide an immutable installer tuple for isolated QA.
-- A later WinGet head automatically makes the app eligible for reconciliation
-- again, while catalog-version mappings and quarantined tuples remain durable.

create table public.qa_catalog_reconciliations (
  winget_id text not null
    references public.curated_apps(winget_id) on update cascade on delete cascade,
  catalog_version text not null,
  observed_head_sha text not null check (observed_head_sha ~ '^[a-f0-9]{40}$'),
  observed_live_version text,
  reason_code text not null check (
    reason_code in (
      'package_or_version_missing',
      'installer_manifest_missing',
      'no_compatible_vm_installer',
      'missing_trusted_installer_metadata',
      'installer_hash_quarantined',
      'package_compatibility_blocked'
    )
  ),
  observed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (winget_id, catalog_version)
);

comment on table public.qa_catalog_reconciliations is
  'Service-only WinGet-head observations that prevent deterministic unavailable QA demand from starving later deployed apps.';

create index qa_catalog_reconciliations_head_idx
  on public.qa_catalog_reconciliations(observed_head_sha, winget_id, catalog_version);

alter table public.qa_catalog_reconciliations enable row level security;
revoke all on table public.qa_catalog_reconciliations from public, anon, authenticated;
grant select, insert, update, delete on table public.qa_catalog_reconciliations to service_role;

-- Seed only exact quarantined tuples observed for the current catalog mapping.
-- A future WinGet head is not excluded; the enqueue route rechecks the live
-- tuple and records a new head-scoped observation only if it is still bad.
insert into public.qa_catalog_reconciliations (
  winget_id,
  catalog_version,
  observed_head_sha,
  observed_live_version,
  reason_code
)
select distinct on (candidate.winget_id, candidate.catalog_version_at_enqueue)
  candidate.winget_id,
  candidate.catalog_version_at_enqueue,
  poll_state.head_sha,
  candidate.version,
  'installer_hash_quarantined'
from public.qa_candidates as candidate
join public.installer_health as health
  on health.winget_id = candidate.winget_id
 and health.version = candidate.version
 and health.architecture = candidate.architecture
 and health.installer_url = candidate.installer_url
 and health.expected_sha256 = candidate.installer_sha256
 and health.status = 'quarantined'
join public.qa_winget_poll_state as poll_state
  on poll_state.id = 'microsoft/winget-pkgs'
 and poll_state.head_sha ~ '^[a-f0-9]{40}$'
where nullif(btrim(candidate.catalog_version_at_enqueue), '') is not null
  and candidate.test_level = 'psadt-package'
  and candidate.test_config @> '{"profileKind":"catalog-default"}'::jsonb
order by
  candidate.winget_id,
  candidate.catalog_version_at_enqueue,
  candidate.updated_at desc
on conflict (winget_id, catalog_version) do update
set observed_head_sha = excluded.observed_head_sha,
    observed_live_version = excluded.observed_live_version,
    reason_code = excluded.reason_code,
    observed_at = now(),
    updated_at = now();

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
       candidate.catalog_version_at_enqueue = current_app.latest_version
       or (
         candidate.catalog_version_at_enqueue is null
         and candidate.version = current_app.latest_version
       )
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
          candidate.catalog_version_at_enqueue = app.latest_version
          or (
            candidate.catalog_version_at_enqueue is null
            and candidate.version = app.latest_version
          )
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
  'Returns customer-deployed Win32 apps missing current catalog QA, excluding current-head unavailable observations and quarantined immutable installer tuples.';

revoke all on function public.qa_missing_demand_backfill_ids(integer)
  from public, anon, authenticated;
grant execute on function public.qa_missing_demand_backfill_ids(integer)
  to service_role;
