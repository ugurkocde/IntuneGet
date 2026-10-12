-- superProductivity is a per-user NSIS application when invoked by LocalSystem.
-- Isolated QA run 32564266080 installed it beneath the LocalSystem profile and
-- captured the exact vendor uninstall registration. Before managed removal,
-- that registration's executable had disappeared while the registration and
-- 2,914 added files remained. The IntuneGet marker cleared, but the vendor
-- application did not, so this lifecycle must not be published.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'JohannesMillan.superProductivity',
  'unsupported_managed_install',
  'superProductivity installs into the LocalSystem profile during device-context deployment, and its exact registered NSIS uninstaller disappeared before managed removal. Isolated QA retained the application registration and 2,914 installed files, so a safe customer lifecycle cannot be verified.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32564266080'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'JohannesMillan.superProductivity';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'JohannesMillan.superProductivity'
  and status in ('queued', 'failed', 'error');
