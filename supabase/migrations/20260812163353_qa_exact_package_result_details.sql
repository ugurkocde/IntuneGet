-- Keep the full sanitized evidence for every exact PSADT package profile.
-- qa_results remains the one-row-per-app catalog projection, while this
-- private table powers exact recent-run details without exposing provenance.
alter table public.qa_package_results
  add column if not exists display_name text,
  add column if not exists publisher text,
  add column if not exists installer_type text,
  add column if not exists install_command text,
  add column if not exists uninstall_command text,
  add column if not exists detection jsonb,
  add column if not exists phase_results jsonb,
  add column if not exists changes jsonb,
  add column if not exists relevant_event_count integer,
  add column if not exists environment jsonb,
  add column if not exists effective_configuration jsonb,
  add column if not exists qa_schema_version integer,
  add column if not exists profile_kind text not null default 'catalog-default';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qa_package_results_profile_kind_check'
      and conrelid = 'public.qa_package_results'::regclass
  ) then
    alter table public.qa_package_results
      add constraint qa_package_results_profile_kind_check
      check (profile_kind in ('catalog-default', 'deployment-config'));
  end if;
end
$$;

-- Canonical package rows can be populated immediately from qa_results. The
-- workflow reconciliation fills configuration-specific historical rows.
update public.qa_package_results as package_result
set display_name = result.display_name,
    publisher = result.publisher,
    installer_type = result.installer_type,
    install_command = result.install_command,
    uninstall_command = result.uninstall_command,
    detection = result.detection,
    phase_results = result.phase_results,
    changes = result.changes,
    relevant_event_count = result.relevant_event_count,
    environment = result.environment,
    effective_configuration = result.effective_configuration,
    qa_schema_version = result.qa_schema_version,
    profile_kind = 'catalog-default'
from public.qa_results as result
where result.package_profile_sha256 = package_result.package_profile_sha256;

-- Preserve the existing synchronization behavior behind a private helper,
-- then enrich every exact package row from the same already-sanitized payload.
alter function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)
  rename to sync_qa_results_v2_metadata_only;

revoke all on function public.sync_qa_results_v2_metadata_only(text, jsonb, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.sync_qa_results_v2_metadata_only(text, jsonb, jsonb, boolean)
  to service_role;

create function public.sync_qa_results_v2(
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
      profile_kind = coalesce(nullif(row_data.profile_kind, ''), 'catalog-default')
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
    profile_kind text
  )
  where row_data.test_level = 'psadt-package'
    and upper(row_data.package_profile_sha256) = package_result.package_profile_sha256
    and row_data.tested_at_utc >= package_result.tested_at_utc;

  return sync_result;
end;
$$;

revoke all on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)
  from public, authenticated, service_role;
grant execute on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)
  to anon;

comment on column public.qa_package_results.profile_kind is
  'Sanitized package profile category used to distinguish catalog QA from customer configuration QA.';
