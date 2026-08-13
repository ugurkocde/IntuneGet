-- Retire packages only after repeated confirmation that WinGet no longer
-- publishes the package or its recorded version.

alter table public.curated_apps
  add column if not exists upstream_miss_count integer not null default 0
  check (upstream_miss_count >= 0);

alter table public.package_eligibility_blocks
  drop constraint if exists package_eligibility_blocks_block_code_check;
alter table public.package_eligibility_blocks
  add constraint package_eligibility_blocks_block_code_check
  check (block_code in ('vendor_retired', 'upstream_removed'));

comment on column public.curated_apps.upstream_miss_count is
  'Consecutive package_or_version_missing results from the manifest sync.';

alter table public.msp_batch_deployments
  add column if not exists architecture text not null default 'x64'
  check (architecture in ('x64', 'x86', 'arm64', 'arm', 'neutral'));

create or replace function public.get_curated_categories()
returns table (category text, app_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select app.category, count(*) as app_count
  from public.curated_apps as app
  where app.is_verified is true
    and app.latest_version is not null
    and app.category is not null
    and app.is_locale_variant is false
  group by app.category
  order by app_count desc;
$$;
