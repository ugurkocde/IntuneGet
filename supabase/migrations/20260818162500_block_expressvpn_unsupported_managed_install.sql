-- ExpressVPN 14 changed from the previously published Burn installer to a
-- generic EXE manifest with no InstallModes or silent switches. Microsoft
-- WinGet validation explicitly reported those missing properties. Isolated
-- PSADT lifecycle QA confirmed that the generic /S fallback exits with code 2
-- and creates no installed-app registration. Do not guess an undocumented
-- command for customer devices; block automated deployment until the vendor
-- or WinGet publishes a verifiable unattended install contract.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'ExpressVPN.ExpressVPN',
  'unsupported_managed_install',
  'ExpressVPN 14 does not publish a verifiable unattended Windows install contract. Its current WinGet manifest omits InstallModes and silent switches, and isolated PSADT QA confirmed that the generic /S fallback exits with code 2 without installing the app.',
  'https://github.com/microsoft/winget-pkgs/pull/390529'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'ExpressVPN.ExpressVPN';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'ExpressVPN.ExpressVPN'
  and status in ('queued', 'failed');
