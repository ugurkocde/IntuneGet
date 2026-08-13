-- Live, sanitized progress for the private single-flight QA queue.
alter table public.qa_candidates
  add column if not exists phase text,
  add column if not exists phase_started_at timestamptz,
  add column if not exists phase_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qa_candidates_phase_check'
      and conrelid = 'public.qa_candidates'::regclass
  ) then
    alter table public.qa_candidates
      add constraint qa_candidates_phase_check check (
        phase is null or phase in (
          'queued',
          'preparing_package',
          'restoring_vm',
          'installing',
          'detecting_install',
          'uninstalling',
          'verifying_removal',
          'publishing'
        )
      );
  end if;
end $$;

create index if not exists qa_results_recent_psadt_idx
  on public.qa_results (tested_at_utc desc)
  where test_level = 'psadt-package';

-- The canonical repository already reports the true package execution context.
-- Keep the public mirror sanitized while preserving LocalSystem versus User.
alter table public.qa_results
  drop constraint if exists qa_results_public_provenance_sanitized;

alter table public.qa_results
  add constraint qa_results_public_provenance_sanitized check (
    test_id is null
    and github_run_id is null
    and github_run_attempt is null
    and (
      environment is null
      or environment = '{"executionContext":"LocalSystem"}'::jsonb
      or environment = '{"executionContext":"User"}'::jsonb
    )
  );

create or replace function public.publish_qa_candidate_phase(
  p_secret text,
  p_candidate_id uuid,
  p_phase text,
  p_observed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  expected_secret_hash constant text := 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921';
  updated_count integer;
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;

  if p_phase is null or p_phase not in (
    'queued',
    'preparing_package',
    'restoring_vm',
    'installing',
    'detecting_install',
    'uninstalling',
    'verifying_removal',
    'publishing'
  ) then
    raise exception 'Invalid QA candidate phase';
  end if;

  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    raise exception 'Invalid QA phase observation time';
  end if;

  update public.qa_candidates
  set
    phase_started_at = case
      when phase is distinct from p_phase then p_observed_at
      else phase_started_at
    end,
    phase = p_phase,
    phase_updated_at = p_observed_at,
    updated_at = greatest(updated_at, p_observed_at)
  where id = p_candidate_id
    and status in ('dispatched', 'running')
    and (phase_updated_at is null or p_observed_at > phase_updated_at);

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.publish_qa_candidate_phase(text, uuid, text, timestamptz)
  from public, authenticated, service_role;
grant execute on function public.publish_qa_candidate_phase(text, uuid, text, timestamptz)
  to anon;

-- Preserve the execution context supplied by the canonical QA JSON while
-- continuing to strip machine identity and GitHub execution provenance.
create or replace function public.sync_qa_results(
  p_secret text,
  p_rows jsonb,
  p_allow_large_delete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  expected_secret_hash constant text := 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921';
  payload_count integer;
  distinct_id_count integer;
  existing_count integer;
  remove_count integer;
  maximum_automatic_deletes integer;
  completed_at timestamptz := now();
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'At least one canonical QA result is required';
  end if;

  payload_count := jsonb_array_length(p_rows);
  select count(distinct item->>'winget_id')
  into distinct_id_count
  from jsonb_array_elements(p_rows) item;
  if distinct_id_count <> payload_count or exists (
    select 1 from jsonb_array_elements(p_rows) item
    where coalesce(item->>'winget_id', '') = ''
  ) then
    raise exception 'Canonical QA result IDs must be present and unique';
  end if;

  select count(*) into existing_count from public.qa_results;
  select count(*)
  into remove_count
  from public.qa_results existing
  where not exists (
    select 1
    from jsonb_array_elements(p_rows) item
    where item->>'winget_id' = existing.winget_id
  );
  maximum_automatic_deletes := greatest(1, floor(existing_count * 0.25)::integer);
  if not p_allow_large_delete and remove_count > maximum_automatic_deletes then
    raise exception 'Refusing unexpectedly large QA result deletion';
  end if;

  insert into public.qa_results (
    winget_id, display_name, publisher, tested_version, architecture, outcome,
    tested_at_utc, overall_duration_seconds, installer_type, install_command,
    uninstall_command, detection, phase_results, changes, relevant_event_count,
    environment, test_id, github_run_id, github_run_attempt, qa_schema_version,
    synced_at
  )
  select
    row_data.winget_id, row_data.display_name, row_data.publisher,
    row_data.tested_version, row_data.architecture, row_data.outcome,
    row_data.tested_at_utc, row_data.overall_duration_seconds,
    row_data.installer_type, row_data.install_command, row_data.uninstall_command,
    row_data.detection, row_data.phase_results, row_data.changes,
    row_data.relevant_event_count,
    case
      when row_data.environment->>'executionContext' = 'User'
        then '{"executionContext":"User"}'::jsonb
      else '{"executionContext":"LocalSystem"}'::jsonb
    end,
    null, null, null, row_data.qa_schema_version, row_data.synced_at
  from jsonb_to_recordset(p_rows) as row_data(
    winget_id text, display_name text, publisher text, tested_version text,
    architecture text, outcome text, tested_at_utc timestamptz,
    overall_duration_seconds numeric, installer_type text, install_command text,
    uninstall_command text, detection jsonb, phase_results jsonb, changes jsonb,
    relevant_event_count integer, environment jsonb, qa_schema_version integer,
    synced_at timestamptz
  )
  on conflict (winget_id) do update set
    display_name = excluded.display_name,
    publisher = excluded.publisher,
    tested_version = excluded.tested_version,
    architecture = excluded.architecture,
    outcome = excluded.outcome,
    tested_at_utc = excluded.tested_at_utc,
    overall_duration_seconds = excluded.overall_duration_seconds,
    installer_type = excluded.installer_type,
    install_command = excluded.install_command,
    uninstall_command = excluded.uninstall_command,
    detection = excluded.detection,
    phase_results = excluded.phase_results,
    changes = excluded.changes,
    relevant_event_count = excluded.relevant_event_count,
    environment = excluded.environment,
    test_id = null,
    github_run_id = null,
    github_run_attempt = null,
    qa_schema_version = excluded.qa_schema_version,
    synced_at = excluded.synced_at;

  delete from public.qa_results existing
  where not exists (
    select 1 from jsonb_array_elements(p_rows) item
    where item->>'winget_id' = existing.winget_id
  );

  insert into public.curated_sync_status (
    id, last_run_started_at, last_run_completed_at, last_run_status,
    items_processed, error_message, metadata, updated_at
  )
  values (
    'sync-qa-results', completed_at, completed_at, 'success', payload_count, null,
    jsonb_build_object(
      'source', 'canonical-checkout',
      'files', payload_count,
      'mirrored', payload_count,
      'removed', remove_count,
      'invalid', jsonb_build_array()
    ),
    completed_at
  )
  on conflict (id) do update set
    last_run_started_at = excluded.last_run_started_at,
    last_run_completed_at = excluded.last_run_completed_at,
    last_run_status = excluded.last_run_status,
    items_processed = excluded.items_processed,
    error_message = excluded.error_message,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'files', payload_count,
    'mirrored', payload_count,
    'removed', remove_count,
    'invalid', jsonb_build_array()
  );
end;
$$;

revoke all on function public.sync_qa_results(text, jsonb, boolean)
  from public, authenticated, service_role;
grant execute on function public.sync_qa_results(text, jsonb, boolean)
  to anon;
