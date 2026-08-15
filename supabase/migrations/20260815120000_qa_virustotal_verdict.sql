-- Informational VirusTotal hash-lookup verdict for QA results. The verdict is
-- produced on the QA host from the already-public installer SHA-256 before
-- packaging; no file content is ever uploaded to VirusTotal and the verdict
-- never gates the QA outcome. Absent columns mean the run predates the check.
alter table public.qa_results
  add column if not exists virustotal_status text,
  add column if not exists virustotal_malicious integer,
  add column if not exists virustotal_suspicious integer,
  add column if not exists virustotal_total_engines integer,
  add column if not exists virustotal_scanned_at_utc timestamptz;

alter table public.qa_package_results
  add column if not exists virustotal_status text,
  add column if not exists virustotal_malicious integer,
  add column if not exists virustotal_suspicious integer,
  add column if not exists virustotal_total_engines integer,
  add column if not exists virustotal_scanned_at_utc timestamptz;

do $$
declare
  target text;
begin
  foreach target in array array['qa_results', 'qa_package_results'] loop
    if not exists (
      select 1
      from pg_constraint
      where conname = target || '_virustotal_status_check'
        and conrelid = ('public.' || target)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I check (virustotal_status is null or virustotal_status in (%L, %L, %L, %L, %L))',
        target, target || '_virustotal_status_check',
        'clean', 'flagged', 'not_found', 'error', 'skipped'
      );
    end if;
    if not exists (
      select 1
      from pg_constraint
      where conname = target || '_virustotal_counts_check'
        and conrelid = ('public.' || target)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I check (
           coalesce(virustotal_malicious, 0) >= 0
           and coalesce(virustotal_suspicious, 0) >= 0
           and coalesce(virustotal_total_engines, 0) >= 0
         )',
        target, target || '_virustotal_counts_check'
      );
    end if;
  end loop;
end
$$;

-- Extend the synchronization wrapper so the verdict rides the existing result
-- payload. The private metadata helper stays untouched; this wrapper keeps the
-- exact package-detail enrichment from 20260812163353 and adds the VirusTotal
-- columns for both the exact package rows and the canonical catalog rows.
create or replace function public.sync_qa_results_v2(
  p_secret text,
  p_rows jsonb,
  p_recipes jsonb,
  p_allow_large_delete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sync_result jsonb;
begin
  sync_result := public.sync_qa_results_v2_metadata_only(
    p_secret,
    p_rows,
    p_recipes,
    p_allow_large_delete
  );

  update public.qa_package_results as package_result
  set display_name = row_data.display_name,
      publisher = row_data.publisher,
      installer_type = row_data.installer_type,
      install_command = row_data.install_command,
      uninstall_command = row_data.uninstall_command,
      detection = row_data.detection,
      phase_results = row_data.phase_results,
      changes = row_data.changes,
      relevant_event_count = row_data.relevant_event_count,
      environment = row_data.environment,
      effective_configuration = row_data.effective_configuration,
      qa_schema_version = row_data.qa_schema_version,
      profile_kind = coalesce(nullif(row_data.profile_kind, ''), 'catalog-default'),
      virustotal_status = row_data.virustotal_status,
      virustotal_malicious = row_data.virustotal_malicious,
      virustotal_suspicious = row_data.virustotal_suspicious,
      virustotal_total_engines = row_data.virustotal_total_engines,
      virustotal_scanned_at_utc = row_data.virustotal_scanned_at_utc
  from pg_catalog.jsonb_to_recordset(p_rows) as row_data(
    package_profile_sha256 text,
    tested_at_utc timestamptz,
    test_level text,
    display_name text,
    publisher text,
    installer_type text,
    install_command text,
    uninstall_command text,
    detection jsonb,
    phase_results jsonb,
    changes jsonb,
    relevant_event_count integer,
    environment jsonb,
    effective_configuration jsonb,
    qa_schema_version integer,
    profile_kind text,
    virustotal_status text,
    virustotal_malicious integer,
    virustotal_suspicious integer,
    virustotal_total_engines integer,
    virustotal_scanned_at_utc timestamptz
  )
  where row_data.test_level = 'psadt-package'
    and upper(row_data.package_profile_sha256) = package_result.package_profile_sha256
    and row_data.tested_at_utc >= package_result.tested_at_utc;

  update public.qa_results as result
  set virustotal_status = row_data.virustotal_status,
      virustotal_malicious = row_data.virustotal_malicious,
      virustotal_suspicious = row_data.virustotal_suspicious,
      virustotal_total_engines = row_data.virustotal_total_engines,
      virustotal_scanned_at_utc = row_data.virustotal_scanned_at_utc
  from pg_catalog.jsonb_to_recordset(p_rows) as row_data(
    winget_id text,
    tested_at_utc timestamptz,
    profile_kind text,
    virustotal_status text,
    virustotal_malicious integer,
    virustotal_suspicious integer,
    virustotal_total_engines integer,
    virustotal_scanned_at_utc timestamptz
  )
  where coalesce(nullif(row_data.profile_kind, ''), 'catalog-default') = 'catalog-default'
    and result.winget_id = row_data.winget_id
    and row_data.tested_at_utc >= result.tested_at_utc;

  return sync_result;
end;
$$;

revoke all on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)
  from public, authenticated, service_role;
grant execute on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)
  to anon;

comment on column public.qa_results.virustotal_status is
  'Informational VirusTotal hash-lookup verdict: clean, flagged, not_found, error, or skipped. Hash-only lookup; never gates the QA outcome.';
comment on column public.qa_package_results.virustotal_status is
  'Informational VirusTotal hash-lookup verdict: clean, flagged, not_found, error, or skipped. Hash-only lookup; never gates the QA outcome.';
