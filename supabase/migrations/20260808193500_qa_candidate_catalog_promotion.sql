-- Promote an exact WinGet release into the deployable catalog immediately
-- after its PSADT package QA result passes. The daily full sync remains a
-- reconciliation job; it is no longer the release path for tested updates.
alter table public.qa_candidates
  add column if not exists catalog_version_at_enqueue text;

comment on column public.qa_candidates.catalog_version_at_enqueue is
  'Optimistic-lock value used to prevent a completed QA run from rolling back a catalog version changed after enqueue.';

-- Existing candidates can safely inherit the catalog value only when the
-- catalog row has not changed since they entered the queue.
update public.qa_candidates as candidate
set catalog_version_at_enqueue = app.latest_version
from public.curated_apps as app
where app.winget_id = candidate.winget_id
  and candidate.catalog_version_at_enqueue is null
  and candidate.enqueued_at >= app.updated_at;

create or replace function public.report_qa_candidate_result(
  p_secret text,
  p_candidate_id uuid,
  p_outcome text,
  p_summary text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  expected_secret_hash constant text := 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921';
  normalized_outcome text := lower(coalesce(p_outcome, ''));
  candidate public.qa_candidates%rowtype;
  changed integer;
  promoted integer := 0;
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;
  if normalized_outcome not in ('passed', 'failed', 'error', 'retry') then
    raise exception 'Invalid QA candidate outcome';
  end if;

  update public.qa_candidates
  set status = case
        when normalized_outcome = 'retry' and attempts < 2 then 'queued'
        when normalized_outcome = 'retry' then 'error'
        else normalized_outcome
      end,
      dispatched_at = case when normalized_outcome = 'retry' and attempts < 2 then null else dispatched_at end,
      started_at = case when normalized_outcome = 'retry' and attempts < 2 then null else started_at end,
      github_run_id = case when normalized_outcome = 'retry' and attempts < 2 then null else github_run_id end,
      github_run_url = case when normalized_outcome = 'retry' and attempts < 2 then null else github_run_url end,
      phase = case when normalized_outcome = 'retry' and attempts < 2 then null else phase end,
      phase_started_at = case when normalized_outcome = 'retry' and attempts < 2 then null else phase_started_at end,
      phase_updated_at = case when normalized_outcome = 'retry' and attempts < 2 then null else phase_updated_at end,
      finished_at = case when normalized_outcome = 'retry' and attempts < 2 then null else now() end,
      failure_summary = case when normalized_outcome = 'passed' then null else left(p_summary, 1000) end,
      updated_at = now()
  where id = p_candidate_id and status in ('dispatched', 'running')
  returning * into candidate;
  get diagnostics changed = row_count;
  if changed <> 1 then
    return false;
  end if;

  if normalized_outcome = 'passed'
     and candidate.test_level = 'psadt-package'
     and candidate.test_config->>'profileKind' = 'catalog-default' then
    if not exists (
      select 1
      from public.qa_results as result
      where result.winget_id = candidate.winget_id
        and result.outcome = 'Passed'
        and result.test_level = 'psadt-package'
        and result.tested_version = candidate.version
        and result.architecture = candidate.architecture
        and result.installer_sha256 = candidate.installer_sha256
        and result.package_profile_sha256 = candidate.package_profile_sha256
    ) then
      raise exception 'Exact passed QA package evidence is missing for catalog promotion';
    end if;

    update public.curated_apps as app
    set latest_version = candidate.version,
        updated_at = now()
    where app.winget_id = candidate.winget_id
      and (
        app.latest_version is not distinct from candidate.catalog_version_at_enqueue
        or app.latest_version = candidate.version
      );
    get diagnostics promoted = row_count;

    if promoted = 1 then
      insert into public.version_history (
        winget_id, version, installer_url, installer_sha256, installer_type,
        installer_scope, silent_args, installers, manifest_fetched_at, updated_at
      )
      values (
        candidate.winget_id,
        candidate.version,
        candidate.installer_url,
        candidate.installer_sha256,
        coalesce(nullif(candidate.test_config->>'sourceInstallerType', ''), candidate.installer_type),
        nullif(candidate.test_config->>'scope', ''),
        nullif(candidate.test_config->>'silentArgs', ''),
        jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'Architecture', candidate.architecture,
          'InstallerUrl', candidate.installer_url,
          'InstallerSha256', candidate.installer_sha256,
          'InstallerType', coalesce(nullif(candidate.test_config->>'sourceInstallerType', ''), candidate.installer_type),
          'Scope', nullif(candidate.test_config->>'scope', ''),
          'InstallerSwitches', case
            when nullif(candidate.test_config->>'silentArgs', '') is null then null
            else jsonb_build_object('Silent', candidate.test_config->>'silentArgs')
          end
        ))),
        now(),
        now()
      )
      on conflict (winget_id, version) do nothing;

      -- A newer release may already be waiting behind this candidate. Move
      -- its optimistic-lock value forward now that this promotion succeeded.
      update public.qa_candidates as pending
      set catalog_version_at_enqueue = candidate.version,
          updated_at = now()
      where pending.winget_id = candidate.winget_id
        and pending.status = 'queued'
        and pending.catalog_version_at_enqueue is not distinct from candidate.catalog_version_at_enqueue;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.report_qa_candidate_result(text, uuid, text, text)
  from public, authenticated, service_role;
grant execute on function public.report_qa_candidate_result(text, uuid, text, text) to anon;

-- Reconcile the newest already-passed exact result per application. The
-- optimistic value above is populated only when the catalog did not change
-- after enqueue, so this cannot overwrite a concurrently refreshed catalog.
with eligible as (
  select distinct on (candidate.winget_id)
    candidate.winget_id,
    candidate.version,
    candidate.catalog_version_at_enqueue
  from public.qa_candidates as candidate
  join public.qa_results as result
    on result.winget_id = candidate.winget_id
   and result.outcome = 'Passed'
   and result.test_level = 'psadt-package'
   and result.tested_version = candidate.version
   and result.architecture = candidate.architecture
   and result.installer_sha256 = candidate.installer_sha256
   and result.package_profile_sha256 = candidate.package_profile_sha256
  where candidate.status = 'passed'
    and candidate.test_level = 'psadt-package'
    and candidate.test_config->>'profileKind' = 'catalog-default'
    and candidate.catalog_version_at_enqueue is not null
  order by candidate.winget_id, candidate.finished_at desc nulls last
)
update public.curated_apps as app
set latest_version = eligible.version,
    updated_at = now()
from eligible
where app.winget_id = eligible.winget_id
  and app.latest_version is not distinct from eligible.catalog_version_at_enqueue;

insert into public.version_history (
  winget_id, version, installer_url, installer_sha256, installer_type,
  installer_scope, silent_args, installers, manifest_fetched_at, updated_at
)
select distinct on (candidate.winget_id, candidate.version)
  candidate.winget_id,
  candidate.version,
  candidate.installer_url,
  candidate.installer_sha256,
  coalesce(nullif(candidate.test_config->>'sourceInstallerType', ''), candidate.installer_type),
  nullif(candidate.test_config->>'scope', ''),
  nullif(candidate.test_config->>'silentArgs', ''),
  jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'Architecture', candidate.architecture,
    'InstallerUrl', candidate.installer_url,
    'InstallerSha256', candidate.installer_sha256,
    'InstallerType', coalesce(nullif(candidate.test_config->>'sourceInstallerType', ''), candidate.installer_type),
    'Scope', nullif(candidate.test_config->>'scope', '')
  ))),
  now(),
  now()
from public.qa_candidates as candidate
join public.qa_results as result
  on result.winget_id = candidate.winget_id
 and result.outcome = 'Passed'
 and result.test_level = 'psadt-package'
 and result.tested_version = candidate.version
 and result.architecture = candidate.architecture
 and result.installer_sha256 = candidate.installer_sha256
 and result.package_profile_sha256 = candidate.package_profile_sha256
join public.curated_apps as app
  on app.winget_id = candidate.winget_id
 and app.latest_version = candidate.version
where candidate.status = 'passed'
  and candidate.test_level = 'psadt-package'
  and candidate.test_config->>'profileKind' = 'catalog-default'
order by candidate.winget_id, candidate.version, candidate.finished_at desc nulls last
on conflict (winget_id, version) do nothing;

-- Queued work has not started and can safely use the newly reconciled catalog
-- value as its optimistic-lock baseline.
update public.qa_candidates as candidate
set catalog_version_at_enqueue = app.latest_version,
    updated_at = now()
from public.curated_apps as app
where app.winget_id = candidate.winget_id
  and candidate.status = 'queued';
