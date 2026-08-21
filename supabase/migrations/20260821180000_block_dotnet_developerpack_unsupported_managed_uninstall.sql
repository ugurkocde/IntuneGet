-- The legacy .NET Framework 4.6.2 Developer Pack installs and registers under
-- LocalSystem, but its managed removal is not reliable on the QA baseline.
-- The vendor Burn command left the exact product registered. A reviewed retry
-- then routed the legacy GUID-keyed MsiExec registration through exact MSI
-- removal, and that also returned without removing the product. Do not claim a
-- managed lifecycle when neither authoritative vendor identity can remove it.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Microsoft.DotNet.Framework.DeveloperPack.4.6',
  'unsupported_managed_uninstall',
  'The .NET Framework 4.6.2 Developer Pack installs and detects under LocalSystem, but both its exact Burn removal command and its exact legacy MSI identity leave the registered product installed.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32510508197'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Microsoft.DotNet.Framework.DeveloperPack.4.6';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Microsoft.DotNet.Framework.DeveloperPack.4.6'
  and status in ('queued', 'failed', 'error');
