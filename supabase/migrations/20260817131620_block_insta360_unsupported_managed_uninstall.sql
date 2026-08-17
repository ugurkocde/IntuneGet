-- Insta360 Link Controller installs and registers successfully, but its exact
-- Inno Setup uninstaller does not complete an unattended removal lifecycle.
-- Two isolated LocalSystem runs used the framework-standard Inno silent flags,
-- closed the known controller, virtual-camera, and driver processes, and ran
-- the uninstaller from a safe working directory. Both runs left the exact
-- {C05A30CA-A10A-4553-9524-5B377F959166}_is1 registration and application
-- files after the bounded 311-second completion window. Insta360's current
-- support material documents guided removal inside Link Controller, not a
-- supported unattended enterprise uninstall contract. Keep this package out
-- of automated Intune packaging until the vendor publishes one.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Insta360.Link.Controller',
  'unsupported_managed_uninstall',
  'Insta360 Link Controller installs silently, but its current vendor removal flow does not provide a reliable unattended Intune uninstall lifecycle.',
  'https://onlinemanual.insta360.com/link/en-us/troubleshooting/controller-client-error/crash'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Insta360.Link.Controller';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Insta360.Link.Controller'
  and status in ('queued', 'failed');
