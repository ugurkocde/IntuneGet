-- Microsoft .NET Native Runtime 2.2 is an AppX framework package. The exact
-- machine-provisioned lifecycle installs and detects successfully, but Windows
-- rejects all-user deregistration with 0x80073CF3 dependency/conflict
-- validation and the exact package remains installed. Do not claim a managed
-- uninstall lifecycle or ship an Intune package that cannot satisfy removal.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Microsoft.DotNet.Native.Runtime',
  'unsupported_managed_uninstall',
  'The .NET Native Runtime 2.2 AppX framework installs and detects under LocalSystem, but Windows rejects exact all-user deregistration with 0x80073CF3 dependency/conflict validation and the package remains detected.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/33346306805'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Microsoft.DotNet.Native.Runtime';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Microsoft.DotNet.Native.Runtime'
  and status in ('queued', 'failed', 'error');
