-- Store the measured end-to-end QA duration for every exact PSADT package
-- profile. The public live page reads recent package results rather than the
-- one-row-per-app catalog projection, so duration belongs on this table too.
alter table public.qa_package_results
  add column if not exists overall_duration_seconds numeric;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qa_package_results_duration_check'
      and conrelid = 'public.qa_package_results'::regclass
  ) then
    alter table public.qa_package_results
      add constraint qa_package_results_duration_check
      check (overall_duration_seconds is null or overall_duration_seconds >= 0);
  end if;
end
$$;

-- Backfill exact catalog-default profiles whose full report is already in the
-- canonical result table. Deployment-specific profiles gain duration on their
-- next result sync because they intentionally do not overwrite qa_results.
update public.qa_package_results as package_result
set overall_duration_seconds = result.overall_duration_seconds
from public.qa_results as result
where result.package_profile_sha256 = package_result.package_profile_sha256
  and result.overall_duration_seconds is not null
  and package_result.overall_duration_seconds is null;

create or replace function public.sync_qa_results_v2(
  p_secret text,
  p_rows jsonb,
  p_recipes jsonb,
  p_allow_large_delete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
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

  select source_synced_at
  into previous_source_timestamp
  from public.qa_sync_watermarks
  where id = 'canonical-results'
  for update;
  if previous_source_timestamp is null then
    raise exception 'QA synchronization watermark is missing';
  end if;
  if payload_source_min <= previous_source_timestamp then
    raise exception 'Stale or replayed QA synchronization payload';
  end if;

  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into canonical_rows
  from jsonb_array_elements(p_rows) item
  where coalesce(item->>'profile_kind', 'catalog-default') = 'catalog-default';

  if jsonb_array_length(canonical_rows) > 0 then
    sync_result := public.sync_qa_results(p_secret, canonical_rows, p_allow_large_delete);

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

  update public.qa_recipes
  set active = false, updated_at = now()
  where active = true;

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

  update public.qa_sync_watermarks
  set source_synced_at = payload_source_min,
      accepted_at = now()
  where id = 'canonical-results';

  return sync_result || jsonb_build_object('recipes', jsonb_array_length(p_recipes));
end;
$$;

revoke all on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)
  from public, authenticated, service_role;
grant execute on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean) to anon;
