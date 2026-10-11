-- Bounded, nondeleting QA publication reconciliation. Full-snapshot deletion
-- and watermark semantics stay with the existing sync_qa_results_v2 RPC.
CREATE OR REPLACE FUNCTION public.sync_qa_results_incremental_base(p_secret text, p_rows jsonb, p_allow_large_delete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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

  remove_count := 0;
  insert into public.qa_results (
    winget_id, display_name, publisher, tested_version, architecture, outcome,
    tested_at_utc, overall_duration_seconds, installer_type, install_command,
    uninstall_command, detection, phase_results, changes, relevant_event_count,
    environment, effective_configuration, test_id, github_run_id,
    github_run_attempt, qa_schema_version, synced_at
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
    row_data.effective_configuration,
    null, null, null, row_data.qa_schema_version, row_data.synced_at
  from jsonb_to_recordset(p_rows) as row_data(
    winget_id text, display_name text, publisher text, tested_version text,
    architecture text, outcome text, tested_at_utc timestamptz,
    overall_duration_seconds numeric, installer_type text, install_command text,
    uninstall_command text, detection jsonb, phase_results jsonb, changes jsonb,
    relevant_event_count integer, environment jsonb, effective_configuration jsonb,
    qa_schema_version integer, synced_at timestamptz
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
    effective_configuration = excluded.effective_configuration,
    test_id = null,
    github_run_id = null,
    github_run_attempt = null,
    qa_schema_version = excluded.qa_schema_version,
    synced_at = excluded.synced_at
  where excluded.tested_at_utc >= public.qa_results.tested_at_utc;

  return jsonb_build_object(
    'files', payload_count,
    'mirrored', payload_count,
    'removed', remove_count,
    'invalid', jsonb_build_array()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_qa_results_incremental_metadata(p_secret text, p_rows jsonb, p_recipes jsonb, p_allow_large_delete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  expected_secret_hash constant text := 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921';
  canonical_rows jsonb;
  sync_result jsonb;
  payload_source_min timestamptz;
  payload_source_max timestamptz;
  payload_null_timestamps integer;
  previous_source_timestamp timestamptz;
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'At least one QA result is required';
  end if;
  if jsonb_typeof(p_recipes) <> 'array' or jsonb_array_length(p_recipes) = 0 then
    raise exception 'At least one canonical QA recipe is required';
  end if;

  select min(row_data.synced_at),
         max(row_data.synced_at),
         (count(*) filter (where row_data.synced_at is null))::integer
  into payload_source_min, payload_source_max, payload_null_timestamps
  from jsonb_to_recordset(p_rows) as row_data(synced_at timestamptz);
  if payload_source_min is null or payload_source_min <> payload_source_max or payload_null_timestamps <> 0 then
    raise exception 'QA result rows must share one non-null source synchronization timestamp';
  end if;

  perform 1 from public.qa_sync_watermarks where id = 'canonical-results' for update;
  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into canonical_rows
  from jsonb_array_elements(p_rows) item
  where coalesce(nullif(item->>'profile_kind', ''), 'catalog-default') = 'catalog-default';

  if jsonb_array_length(canonical_rows) > 0 then
    sync_result := public.sync_qa_results_incremental_base(p_secret, canonical_rows, p_allow_large_delete);

    update public.qa_results result
    set installer_sha256 = upper(row_data.installer_sha256),
        test_level = coalesce(row_data.test_level, 'installer-preflight'),
        package_profile_sha256 = upper(row_data.package_profile_sha256),
        psadt_version = row_data.psadt_version,
        psadt_template_sha256 = upper(row_data.psadt_template_sha256),
        psadt_config_sha256 = upper(row_data.psadt_config_sha256),
        detection_rules_sha256 = upper(row_data.detection_rules_sha256),
        packager_commit = lower(row_data.packager_commit),
        package_content_sha256 = upper(row_data.package_content_sha256)
    from jsonb_to_recordset(canonical_rows) as row_data(
      winget_id text,
      tested_at_utc timestamptz,
      installer_sha256 text,
      test_level text,
      package_profile_sha256 text,
      psadt_version text,
      psadt_template_sha256 text,
      psadt_config_sha256 text,
      detection_rules_sha256 text,
      packager_commit text,
      package_content_sha256 text
    )
    where result.winget_id = row_data.winget_id
      and row_data.tested_at_utc >= result.tested_at_utc;
  else
    sync_result := jsonb_build_object(
      'files', 0,
      'mirrored', 0,
      'removed', 0,
      'invalid', jsonb_build_array()
    );
  end if;

  insert into public.qa_package_results (
    package_profile_sha256,
    winget_id,
    tested_version,
    architecture,
    installer_sha256,
    outcome,
    tested_at_utc,
    overall_duration_seconds,
    psadt_version,
    psadt_template_sha256,
    psadt_config_sha256,
    detection_rules_sha256,
    packager_commit,
    package_content_sha256,
    github_run_id,
    github_run_url,
    synced_at
  )
  select
    upper(row_data.package_profile_sha256),
    row_data.winget_id,
    row_data.tested_version,
    row_data.architecture,
    upper(row_data.installer_sha256),
    row_data.outcome,
    row_data.tested_at_utc,
    row_data.overall_duration_seconds,
    row_data.psadt_version,
    upper(row_data.psadt_template_sha256),
    upper(row_data.psadt_config_sha256),
    upper(row_data.detection_rules_sha256),
    lower(row_data.packager_commit),
    upper(row_data.package_content_sha256),
    row_data.github_run_id,
    row_data.github_run_url,
    now()
  from jsonb_to_recordset(p_rows) as row_data(
    winget_id text,
    tested_version text,
    architecture text,
    installer_sha256 text,
    outcome text,
    tested_at_utc timestamptz,
    overall_duration_seconds numeric,
    test_level text,
    package_profile_sha256 text,
    psadt_version text,
    psadt_template_sha256 text,
    psadt_config_sha256 text,
    detection_rules_sha256 text,
    packager_commit text,
    package_content_sha256 text,
    github_run_id text,
    github_run_url text
  )
  where row_data.test_level = 'psadt-package'
  on conflict (package_profile_sha256) do update set
    outcome = excluded.outcome,
    tested_at_utc = excluded.tested_at_utc,
    overall_duration_seconds = excluded.overall_duration_seconds,
    package_content_sha256 = excluded.package_content_sha256,
    github_run_id = excluded.github_run_id,
    github_run_url = excluded.github_run_url,
    synced_at = excluded.synced_at
  where excluded.tested_at_utc >= public.qa_package_results.tested_at_utc;

  insert into public.qa_recipes (
    winget_id,
    definition_path,
    architecture,
    installer_type,
    active,
    updated_at
  )
  select
    recipe.winget_id,
    recipe.definition_path,
    recipe.architecture,
    recipe.installer_type,
    true,
    now()
  from jsonb_to_recordset(p_recipes) as recipe(
    winget_id text,
    definition_path text,
    architecture text,
    installer_type text
  )
  on conflict (winget_id) do update set
    definition_path = excluded.definition_path,
    architecture = excluded.architecture,
    installer_type = excluded.installer_type,
    active = true,
    updated_at = excluded.updated_at;

  return sync_result || jsonb_build_object('recipes', jsonb_array_length(p_recipes));
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_qa_results_incremental(p_secret text, p_rows jsonb, p_recipes jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
-- PostgREST hoists this timeout before RPC execution, matching the existing v2 setting.
SET statement_timeout TO '30s'
AS $function$
declare
  sync_result jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100
     or octet_length(p_rows::text) > 1000000 then
    raise exception 'Incremental QA result batch exceeds row or byte bounds';
  end if;
  if jsonb_typeof(p_recipes) is distinct from 'array' or jsonb_array_length(p_recipes) not between 1 and 100 then
    raise exception 'Incremental QA recipes must be bounded';
  end if;
  sync_result := public.sync_qa_results_incremental_metadata(
    p_secret,
    p_rows,
    p_recipes,
    false
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
$function$;

revoke all on function public.sync_qa_results_incremental_base(text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.sync_qa_results_incremental_metadata(text, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.sync_qa_results_incremental(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_qa_results_incremental(text, jsonb, jsonb) to anon;

-- Exact package configuration remains private. Recovery compares it only
-- through the existing synchronization credential, with bounded keyset pages.
create or replace function public.read_qa_package_results_page(p_secret text, p_after text default null, p_limit integer default 500)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $function$
begin
  if pg_catalog.encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921' then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;
  if p_limit is null or p_limit not between 1 and 500 or (p_after is not null and p_after !~ '^[A-F0-9]{64}$') then
    raise exception 'Invalid package read bounds';
  end if;
  return query
    select pg_catalog.to_jsonb(result) from (
      select winget_id,display_name,publisher,tested_version,architecture,outcome,tested_at_utc,overall_duration_seconds,installer_type,install_command,uninstall_command,detection,phase_results,changes,relevant_event_count,environment,qa_schema_version,installer_sha256,package_profile_sha256,psadt_version,psadt_template_sha256,psadt_config_sha256,detection_rules_sha256,packager_commit,package_content_sha256,effective_configuration,virustotal_status,virustotal_malicious,virustotal_suspicious,virustotal_total_engines,virustotal_scanned_at_utc,profile_kind,github_run_id,github_run_url
      from public.qa_package_results
      where p_after is null or package_profile_sha256 > p_after
      order by package_profile_sha256
      limit p_limit
    ) result;
end;
$function$;
revoke all on function public.read_qa_package_results_page(text, text, integer) from public, anon, authenticated;
grant execute on function public.read_qa_package_results_page(text, text, integer) to anon;
