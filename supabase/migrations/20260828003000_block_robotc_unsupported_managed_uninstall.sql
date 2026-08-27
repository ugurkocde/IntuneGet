-- ROBOTC for LEGO Mindstorms 4.56 installs and detects successfully under
-- LocalSystem, but its vendor HelpDocs uninstall action attempts nested
-- Windows Installer work and cannot complete unattended. Two isolated runs
-- exercised distinct removal paths: direct exact MSI removal and the original
-- manifest-hashed InstallShield wrapper with /S /x /V/quiet /V/norestart.
-- Both reached the same 281-second no-activity timeout and left the exact
-- {9701AFD7-E853-4CCB-88DA-306B2F37546D} product registration installed.
-- Do not publish a PSADT package whose managed removal cannot be verified.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Robomatter.ROBOTC.LEGOMindstorms',
  'unsupported_managed_uninstall',
  'ROBOTC for LEGO Mindstorms 4.56 installs unattended, but two isolated LocalSystem lifecycle runs could not remove it. Direct exact MSI removal and the manifest-hashed InstallShield wrapper both reached the same 281-second no-activity timeout and left the exact product registration installed.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/33121783325'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Robomatter.ROBOTC.LEGOMindstorms';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Robomatter.ROBOTC.LEGOMindstorms'
  and status in ('queued', 'failed', 'error');
