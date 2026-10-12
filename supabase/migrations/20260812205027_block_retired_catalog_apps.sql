-- Some upstream package records remain available after the publisher has
-- retired the product or the service it depends on. These are application-
-- level eligibility decisions, not version-specific installer failures.

create table public.package_eligibility_blocks (
  winget_id text primary key
    references public.curated_apps(winget_id) on update cascade on delete cascade,
  block_code text not null check (block_code in ('vendor_retired')),
  detail text not null check (char_length(detail) between 1 and 1000),
  source_url text not null check (source_url ~ '^https://'),
  blocked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.package_eligibility_blocks is
  'Service-only application-level blocks shared by catalog, customer packaging, auto-update, and QA.';

alter table public.package_eligibility_blocks enable row level security;
revoke all on table public.package_eligibility_blocks from public, anon, authenticated;
grant select, insert, update, delete on table public.package_eligibility_blocks to service_role;

create or replace function public.enforce_catalog_package_eligibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.package_eligibility_blocks as block
    where block.winget_id = new.winget_id
  ) then
    new.is_verified := false;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_catalog_package_eligibility()
  from public, anon, authenticated;
grant execute on function public.enforce_catalog_package_eligibility()
  to service_role;

create trigger curated_apps_enforce_package_eligibility
before insert or update on public.curated_apps
for each row
when (new.is_verified is true)
execute function public.enforce_catalog_package_eligibility();

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Autodesk.DesktopApp',
  'vendor_retired',
  'Autodesk discontinued Desktop App and its backend content services. Autodesk Access is the supported successor.',
  'https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/Is-the-Autodesk-Desktop-App-now-called-Autodesk-Access.html'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps as app
set is_verified = false
where exists (
  select 1
  from public.package_eligibility_blocks as block
  where block.winget_id = app.winget_id
);

update public.qa_candidates as candidate
set status = 'superseded',
    finished_at = coalesce(candidate.finished_at, now()),
    failure_summary = 'QA superseded because this application is no longer available from its publisher.',
    updated_at = now()
where candidate.status = 'queued'
  and exists (
    select 1
    from public.package_eligibility_blocks as block
    where block.winget_id = candidate.winget_id
  );

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
    failure.last_failed_at desc nulls last,
    demand.has_auto_update desc,
    demand.last_demanded_at desc nulls last,
    app.winget_id asc
  limit greatest(1, least(coalesce(p_limit, 3), 100));
$$;

comment on function public.qa_missing_demand_backfill_ids(integer) is
  'Returns customer-deployed Win32 apps missing current-version QA, excluding application- and version-level compatibility blocks.';

revoke all on function public.qa_missing_demand_backfill_ids(integer)
  from public, anon, authenticated;
grant execute on function public.qa_missing_demand_backfill_ids(integer)
  to service_role;
