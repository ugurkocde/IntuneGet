-- Exact isolated LocalSystem run 34436253877: 14.0.33728.0 x64,
-- lifecycle 0/0/60001/0. Windows rejected Remove-AppxPackage -AllUsers
-- for Microsoft.VCLibs.140.00.UWPDesktop with 0x80073CF3. Do not force
-- framework removal, remove dependent applications, or ignore the failure.
-- Shared customer/QA eligibility gate; generator and pins are unchanged.
insert into public.package_eligibility_blocks (winget_id, block_code, detail, source_url)
values (
  'Microsoft.VCLibs.Desktop.14',
  'unsupported_managed_uninstall',
  'VCLibs Desktop 14 AppX framework 14.0.33728.0 x64 installs and detects under LocalSystem, but Windows rejects exact all-user removal with 0x80073CF3 dependency/conflict validation and the framework remains detected. Standalone automated deployment is blocked until a safe managed removal contract is available.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34436253877'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Microsoft.VCLibs.Desktop.14';

-- Preserve failed lifecycle and security evidence, and all dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = now(), updated_at = now(),
    failure_summary = 'This app is not available for automated deployment.'
where winget_id = 'Microsoft.VCLibs.Desktop.14'
  and status = 'queued' and dispatched_at is null and attempts = 0;
