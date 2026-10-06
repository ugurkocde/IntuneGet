-- A failed lifecycle is a fault of that application, not of the pipeline.
-- Infrastructure faults arrive as 'retry'/'error' and are recovered separately.
-- Previously every 'failed' result paused the global dispatcher, so one app
-- blocked every customer until its repair finished (issue #1374). A failure
-- now records a durable repair request in the same transaction and the queue
-- keeps running. Repair automation fixes the app and re-queues the exact
-- tuple; after three re-queues the app is blocked instead of retried forever.
-- Security verdicts are never repaired or retried.
create table if not exists public.qa_repair_requests (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.qa_candidates(id) on delete cascade,
  winget_id text not null,
  version text not null,
  architecture text not null,
  failure_class text not null check (failure_class in ('app_lifecycle', 'security')),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'requeued', 'blocked', 'resolved')),
  prior_requeues integer not null default 0 check (prior_requeues >= 0),
  failure_summary text,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists qa_repair_requests_open_idx
  on public.qa_repair_requests(created_at)
  where status in ('pending', 'in_progress');

alter table public.qa_repair_requests enable row level security;
revoke all on table public.qa_repair_requests from public, anon, authenticated;
grant select, insert, update on table public.qa_repair_requests to service_role;

comment on table public.qa_repair_requests is
  'Private per-application QA repair queue. Replaces the global fail-close pause for failed lifecycles.';
comment on column public.qa_repair_requests.prior_requeues is
  'Earlier repair requests for the same app and architecture that were re-queued. At three the request starts blocked.';

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
  prior_requeue_count integer := 0;
  is_security_failure boolean := false;
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

  if normalized_outcome = 'failed' then
    is_security_failure := coalesce(p_summary, '') ilike '%VirusTotal%';

    select count(*) into prior_requeue_count
    from public.qa_repair_requests as earlier
    where earlier.winget_id = candidate.winget_id
      and earlier.architecture = candidate.architecture
      and earlier.status = 'requeued';

    insert into public.qa_repair_requests (
      candidate_id, winget_id, version, architecture, failure_class, status,
      prior_requeues, failure_summary, resolution
    )
    values (
      candidate.id,
      candidate.winget_id,
      candidate.version,
      candidate.architecture,
      case when is_security_failure then 'security' else 'app_lifecycle' end,
      case when is_security_failure or prior_requeue_count >= 3 then 'blocked' else 'pending' end,
      prior_requeue_count,
      left(p_summary, 1000),
      case
        when is_security_failure then 'Security verdict. Never repaired or retried.'
        when prior_requeue_count >= 3 then 'Repair budget exhausted after three re-queues.'
      end
    )
    on conflict (candidate_id) do nothing;
  end if;

  -- Only catalog-default candidates are anchored to a mutable curated catalog
  -- version. A deployment-config candidate must retain its exact requested
  -- version across recoverable infrastructure retries.
  if normalized_outcome = 'retry'
     and candidate.status = 'queued'
     and candidate.test_config->>'profileKind' = 'catalog-default'
     and exists (
       select 1
       from public.curated_apps as app
       where app.winget_id = candidate.winget_id
         and app.latest_version is distinct from candidate.catalog_version_at_enqueue
         and app.latest_version is distinct from candidate.version
     ) then
    update public.qa_candidates
    set status = 'superseded',
        finished_at = now(),
        failure_summary = 'Retry superseded because the catalog version changed after enqueue.',
        updated_at = now()
    where id = candidate.id;
    return true;
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

    if exists (
      select 1
      from public.qa_candidates as later
      where later.winget_id = candidate.winget_id
        and later.test_level = 'psadt-package'
        and later.test_config->>'profileKind' = 'catalog-default'
        and later.enqueued_at > candidate.enqueued_at
    ) then
      update public.qa_candidates
      set failure_summary = 'Catalog promotion skipped because a newer release candidate exists.',
          updated_at = now()
      where id = candidate.id;
      return true;
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

    if promoted = 0 then
      update public.qa_candidates
      set failure_summary = 'Catalog promotion skipped because the catalog version changed after enqueue.',
          updated_at = now()
      where id = candidate.id;
      return true;
    end if;

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
  end if;

  return true;
end;
$$;

revoke all on function public.report_qa_candidate_result(text, uuid, text, text)
  from public, authenticated, service_role;
grant execute on function public.report_qa_candidate_result(text, uuid, text, text) to anon;

-- Failures recorded under the old fail-close contract still need repair.
insert into public.qa_repair_requests (
  candidate_id, winget_id, version, architecture, failure_class, status,
  failure_summary, resolution
)
select
  c.id,
  c.winget_id,
  c.version,
  c.architecture,
  case when coalesce(c.failure_summary, '') ilike '%VirusTotal%' then 'security' else 'app_lifecycle' end,
  case when coalesce(c.failure_summary, '') ilike '%VirusTotal%' then 'blocked' else 'pending' end,
  c.failure_summary,
  case when coalesce(c.failure_summary, '') ilike '%VirusTotal%'
    then 'Security verdict. Never repaired or retried.' end
from public.qa_candidates as c
where c.status = 'failed'
  and c.finished_at >= '2026-10-06T00:00:00Z'
on conflict (candidate_id) do nothing;
