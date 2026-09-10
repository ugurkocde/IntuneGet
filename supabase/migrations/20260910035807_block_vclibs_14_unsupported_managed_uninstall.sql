-- Exact isolated LocalSystem run 34434594832 installed/detected VCLibs 14
-- 14.0.33519.0 x64, but Remove-AppxPackage -AllUsers failed with 0x80073CF3
-- and removal detection remained 0 (present). This shared AppX framework
-- cannot satisfy our standalone managed removal contract. Never remove its
-- dependent applications or ignore the Windows dependency validation.
-- Official identity: microsoft/winget-pkgs manifests/m/Microsoft/VCLibs/14/
-- Microsoft error reference: https://learn.microsoft.com/en-us/windows/win32/appxpkg/troubleshooting
-- This uses the existing customer packaging / QA eligibility gate; no
-- generator behavior or packager pin changes are needed.
insert into public.package_eligibility_blocks (winget_id, block_code, detail, source_url)
values (
  'Microsoft.VCLibs.14',
  'unsupported_managed_uninstall',
  'VCLibs 14 AppX framework 14.0.33519.0 x64 installs and detects under LocalSystem, but Windows rejects exact all-user removal with 0x80073CF3 dependency/conflict validation and the framework remains detected. Standalone automated deployment is blocked until a safe managed removal contract is available.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34434594832'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Microsoft.VCLibs.14';

-- Preserve the failed lifecycle and all security evidence. Only undispatched
-- work is superseded; the block also prevents fresh demand and queue claims.
update public.qa_candidates
set status = 'superseded', finished_at = now(), updated_at = now(),
    failure_summary = 'This app is not available for automated deployment.'
where winget_id = 'Microsoft.VCLibs.14'
  and status = 'queued' and dispatched_at is null and attempts = 0;
