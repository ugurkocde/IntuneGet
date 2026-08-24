alter table public.qa_poll_runs
  add column if not exists catalog_backfill_requested_count integer not null default 0
    check (catalog_backfill_requested_count >= 0),
  add column if not exists catalog_backfill_count integer not null default 0
    check (catalog_backfill_count >= 0);

comment on column public.qa_poll_runs.catalog_backfill_requested_count is
  'Number of popularity-prioritized catalog app IDs requested while the QA runner and queue were idle.';
comment on column public.qa_poll_runs.catalog_backfill_count is
  'Number of requested idle catalog app IDs that remained in the verified Win32 catalog scope.';

create or replace function public.qa_idle_catalog_backfill_ids(
  p_limit integer default 3
)
returns table(winget_id text)
language sql
stable
security invoker
set search_path = ''
as $$
  select app.winget_id
  from public.curated_apps as app
  where not exists (
      select 1
      from public.qa_candidates as waiting_work
      where waiting_work.status = 'queued'
    )
    and not exists (
      select 1
      from public.qa_candidates as active_work
      where active_work.status in ('dispatched', 'running')
    )
    and app.is_verified is true
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
    app.popularity_rank asc nulls last,
    app.chocolatey_downloads desc nulls last,
    app.updated_at desc,
    app.winget_id asc
  limit greatest(1, least(coalesce(p_limit, 3), 20));
$$;

comment on function public.qa_idle_catalog_backfill_ids(integer) is
  'Returns popular verified Win32 catalog apps missing current PSADT lifecycle coverage, but only while no QA candidate is queued or active.';

revoke all on function public.qa_idle_catalog_backfill_ids(integer)
  from public, anon, authenticated;
grant execute on function public.qa_idle_catalog_backfill_ids(integer)
  to service_role;
