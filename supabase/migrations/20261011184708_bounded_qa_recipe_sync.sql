-- Permit bounded recipe-only updates without rewriting QA lifecycle evidence.
-- The base result writer, private page reader and full-snapshot RPC stay unchanged.
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
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_typeof(p_recipes) is distinct from 'array' then
    raise exception 'QA result and recipe payloads must be arrays';
  end if;
  if jsonb_array_length(p_rows) + jsonb_array_length(p_recipes) = 0 then
    raise exception 'At least one QA result or recipe is required';
  end if;
  if exists (select 1 from jsonb_array_elements(p_recipes) recipe
    where coalesce(recipe->>'winget_id', '') !~ '^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$'
       or coalesce(recipe->>'definition_path', '') = '') then
    raise exception 'Canonical recipe identity and definition path are required';
  end if;

  if jsonb_array_length(p_rows) > 0 then
  select min(row_data.synced_at),
         max(row_data.synced_at),
         (count(*) filter (where row_data.synced_at is null))::integer
  into payload_source_min, payload_source_max, payload_null_timestamps
  from jsonb_to_recordset(p_rows) as row_data(synced_at timestamptz);
  if payload_source_min is null or payload_source_min <> payload_source_max or payload_null_timestamps <> 0 then
    raise exception 'QA result rows must share one non-null source synchronization timestamp';
  end if;

  perform 1 from public.qa_sync_watermarks where id = 'canonical-results' for update;
  end if;
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
  if pg_catalog.encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921' then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 0 and 100
     or octet_length(p_rows::text) > 1000000 then
    raise exception 'Incremental QA result batch exceeds row or byte bounds';
  end if;
  if jsonb_typeof(p_recipes) is distinct from 'array' or jsonb_array_length(p_recipes) not between 0 and 100
     or octet_length(p_rows::text) + octet_length(p_recipes::text) > 1000000 then
    raise exception 'Incremental QA recipes must be bounded';
  end if;
  if jsonb_array_length(p_rows) + jsonb_array_length(p_recipes) = 0 then
    raise exception 'At least one QA result or recipe is required';
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

