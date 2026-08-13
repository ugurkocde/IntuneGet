-- A customer-facing QA pass must represent the generated PSADT package, not
-- merely the vendor installer. Existing rows remain visible as historical
-- installer preflight evidence but are excluded from the package release gate.

alter table public.qa_results
  add column if not exists test_level text not null default 'installer-preflight',
  add column if not exists package_profile_sha256 text,
  add column if not exists psadt_version text,
  add column if not exists psadt_template_sha256 text,
  add column if not exists psadt_config_sha256 text,
  add column if not exists detection_rules_sha256 text,
  add column if not exists packager_commit text,
  add column if not exists package_content_sha256 text;

alter table public.qa_results
  add constraint qa_results_test_level_check
    check (test_level in ('installer-preflight', 'psadt-package')),
  add constraint qa_results_package_profile_sha256_check
    check (package_profile_sha256 is null or package_profile_sha256 ~ '^[A-F0-9]{64}$'),
  add constraint qa_results_psadt_template_sha256_check
    check (psadt_template_sha256 is null or psadt_template_sha256 ~ '^[A-F0-9]{64}$'),
  add constraint qa_results_psadt_config_sha256_check
    check (psadt_config_sha256 is null or psadt_config_sha256 ~ '^[A-F0-9]{64}$'),
  add constraint qa_results_detection_rules_sha256_check
    check (detection_rules_sha256 is null or detection_rules_sha256 ~ '^[A-F0-9]{64}$'),
  add constraint qa_results_packager_commit_check
    check (packager_commit is null or packager_commit ~ '^[a-f0-9]{40}$'),
  add constraint qa_results_package_content_sha256_check
    check (package_content_sha256 is null or package_content_sha256 ~ '^[A-F0-9]{64}$'),
  add constraint qa_results_psadt_provenance_check
    check (
      test_level <> 'psadt-package' or (
        package_profile_sha256 is not null and
        psadt_version is not null and
        psadt_template_sha256 is not null and
        psadt_config_sha256 is not null and
        detection_rules_sha256 is not null and
        packager_commit is not null and
        package_content_sha256 is not null
      )
    );

alter table public.qa_candidates
  add column if not exists test_level text not null default 'installer-preflight',
  add column if not exists package_profile_sha256 text;

alter table public.qa_candidates
  add constraint qa_candidates_test_level_check
    check (test_level in ('installer-preflight', 'psadt-package')),
  add constraint qa_candidates_package_profile_sha256_check
    check (package_profile_sha256 is null or package_profile_sha256 ~ '^[A-F0-9]{64}$'),
  add constraint qa_candidates_psadt_profile_check
    check (test_level <> 'psadt-package' or package_profile_sha256 is not null);

alter table public.qa_candidates
  drop constraint if exists qa_candidates_winget_id_version_architecture_installer_sha2_key;

create unique index if not exists qa_candidates_exact_package_key
  on public.qa_candidates(
    winget_id,
    version,
    architecture,
    installer_sha256,
    package_profile_sha256
  )
  where package_profile_sha256 is not null;

-- Package profiles may vary by PSADT configuration. Preserve every exact
-- tested identity privately even though the public catalog exposes only the
-- latest canonical per-app JSON row.
create table public.qa_package_results (
  package_profile_sha256 text primary key check (package_profile_sha256 ~ '^[A-F0-9]{64}$'),
  winget_id text not null references public.curated_apps(winget_id) on update cascade,
  tested_version text not null,
  architecture text not null check (architecture in ('x64', 'x86', 'arm64')),
  installer_sha256 text not null check (installer_sha256 ~ '^[A-F0-9]{64}$'),
  outcome text not null check (outcome in ('Passed', 'Failed')),
  tested_at_utc timestamptz not null,
  psadt_version text not null,
  psadt_template_sha256 text not null check (psadt_template_sha256 ~ '^[A-F0-9]{64}$'),
  psadt_config_sha256 text not null check (psadt_config_sha256 ~ '^[A-F0-9]{64}$'),
  detection_rules_sha256 text not null check (detection_rules_sha256 ~ '^[A-F0-9]{64}$'),
  packager_commit text not null check (packager_commit ~ '^[a-f0-9]{40}$'),
  package_content_sha256 text not null check (package_content_sha256 ~ '^[A-F0-9]{64}$'),
  github_run_id text,
  github_run_url text,
  synced_at timestamptz not null default now()
);

create index qa_package_results_release_gate_idx
  on public.qa_package_results(
    winget_id,
    tested_version,
    architecture,
    installer_sha256,
    package_profile_sha256,
    outcome
  );

alter table public.qa_package_results enable row level security;
revoke all on table public.qa_package_results from public, anon, authenticated;
grant select, insert, update, delete on table public.qa_package_results to service_role;

-- Candidate test_config now contains the effective PSADT configuration. Keep
-- it private and serve only the compact status through the server API.
drop policy if exists "QA candidate states are publicly readable" on public.qa_candidates;
revoke all on table public.qa_candidates from anon, authenticated;
grant select, insert, update, delete on table public.qa_candidates to service_role;

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
  sync_result jsonb;
begin
  sync_result := public.sync_qa_results(p_secret, p_rows, p_allow_large_delete);

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
  from jsonb_to_recordset(p_rows) as row_data(
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
    synced_at = excluded.synced_at;

  if jsonb_typeof(p_recipes) <> 'array' or jsonb_array_length(p_recipes) = 0 then
    raise exception 'At least one canonical QA recipe is required';
  end if;

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
