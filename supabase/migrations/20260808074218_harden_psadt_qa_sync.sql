-- Keep the public per-app mirror canonical while retaining every exact
-- deployment-config profile in the private release-gate table. Also make
-- result replay monotonic and validate the QA-only secret at this boundary.

alter table public.qa_package_results
  drop constraint if exists qa_package_results_winget_id_fkey;

alter table public.qa_package_results
  add constraint qa_package_results_winget_id_fkey
  foreign key (winget_id)
  references public.curated_apps(winget_id)
  on update cascade
  on delete cascade;

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
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'QA results must be an array';
  end if;
  if jsonb_typeof(p_recipes) <> 'array' or jsonb_array_length(p_recipes) = 0 then
    raise exception 'At least one canonical QA recipe is required';
  end if;

  select coalesce(jsonb_agg(item), '[]'::jsonb)
  into canonical_rows
  from jsonb_array_elements(p_rows) item
  where coalesce(item->>'profile_kind', 'catalog-default') = 'catalog-default';

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
  where result.winget_id = row_data.winget_id;

  insert into public.qa_package_results (
    package_profile_sha256,
    winget_id,
    tested_version,
    architecture,
    installer_sha256,
    outcome,
    tested_at_utc,
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

  return sync_result || jsonb_build_object('recipes', jsonb_array_length(p_recipes));
end;
$$;

revoke all on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)
  from public, authenticated, service_role;
grant execute on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean) to anon;
