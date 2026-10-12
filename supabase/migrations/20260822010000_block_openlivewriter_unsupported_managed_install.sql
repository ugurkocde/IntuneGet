-- Open Live Writer 0.6.2 is built with Squirrel.Windows 1.4.4 and the vendor
-- publishes only its per-user Setup.exe. Squirrel's installation contract
-- writes the application beneath the executing user's %LocalAppData%; the
-- corresponding Update.exe removal contract is bound to that same profile.
-- Under Intune LocalSystem this targets the SYSTEM profile rather than any
-- employee profile, so adding the supported --silent switch cannot produce a
-- usable machine-wide deployment. Exact isolated QA also confirmed that the
-- catalog-default command created no authoritative machine registration:
-- https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32541754573
-- Squirrel install-location contract:
-- https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/install-process.md

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'OpenLiveWriter.OpenLiveWriter',
  'unsupported_managed_install',
  'Open Live Writer 0.6.2 uses a per-user Squirrel installer. Under Intune LocalSystem it targets the SYSTEM profile instead of employee profiles, and exact isolated QA created no authoritative machine registration for detection or managed removal.',
  'https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/install-process.md'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'OpenLiveWriter.OpenLiveWriter';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'OpenLiveWriter.OpenLiveWriter'
  and status in ('queued', 'failed', 'error');
