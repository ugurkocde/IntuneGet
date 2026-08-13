-- Persist exact package versions that cannot be tested or deployed safely
-- under the current packaging contract. A new version remains eligible.

create table public.qa_package_blocks (
  winget_id text not null references public.curated_apps(winget_id) on update cascade,
  version text not null,
  architecture text not null check (architecture in ('x64', 'x86', 'arm64')),
  installer_sha256 text not null check (installer_sha256 ~ '^[A-F0-9]{64}$'),
  block_code text not null check (block_code in ('user_scope_machine_dependencies')),
  detail text not null check (char_length(detail) between 1 and 1000),
  observed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (winget_id, version, architecture, installer_sha256)
);

comment on table public.qa_package_blocks is
  'Service-only version-specific compatibility blocks discovered before isolated QA execution.';

create index qa_package_blocks_app_version_idx
  on public.qa_package_blocks(winget_id, version);

alter table public.qa_package_blocks enable row level security;
revoke all on table public.qa_package_blocks from public, anon, authenticated;
grant select, insert, update, delete on table public.qa_package_blocks to service_role;

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
    and not exists (
      select 1
      from public.qa_package_blocks as block
      where block.winget_id = app.winget_id
        and block.version = app.latest_version
    )
  order by
    demand.has_auto_update desc,
    demand.last_demanded_at desc nulls last,
    app.winget_id asc
  limit greatest(1, least(coalesce(p_limit, 3), 100));
$$;

comment on function public.qa_missing_demand_backfill_ids(integer) is
  'Returns customer-deployed Win32 apps missing current-version QA and not blocked by a reviewed compatibility boundary.';

revoke all on function public.qa_missing_demand_backfill_ids(integer)
  from public, anon, authenticated;
grant execute on function public.qa_missing_demand_backfill_ids(integer)
  to service_role;
