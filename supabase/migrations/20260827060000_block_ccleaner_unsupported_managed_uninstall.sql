-- CCleaner's official command-line reference documents silent installation,
-- but it does not publish an unattended uninstall contract:
-- https://support.ccleaner.com/articles/en_US/Master_Article/command-line-parameters-for-ccleaner-for-windows
-- In two isolated LocalSystem lifecycle runs across CCleaner 7.10 and 7.11,
-- the exact registered Icarus command (`/manual_update /uninstall:piriform-ccl`)
-- launched without removing the exact `CCleaner 7` registration before the
-- bounded five-minute completion deadline. Do not guess an undocumented
-- switch for customer packages or report a lifecycle that cannot be managed.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Piriform.CCleaner',
  'unsupported_managed_uninstall',
  'CCleaner installs unattended, but its exact registered Icarus removal command failed in two isolated LocalSystem lifecycle runs across versions 7.10 and 7.11. The vendor does not document a supported unattended uninstall contract, so IntuneGet will not guess one for managed customer deployments.',
  'https://support.ccleaner.com/articles/en_US/Master_Article/command-line-parameters-for-ccleaner-for-windows'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Piriform.CCleaner';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Piriform.CCleaner'
  and status in ('queued', 'failed', 'error');
