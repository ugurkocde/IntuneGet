-- Firezone Client GUI 1.5.16 installs successfully, but its signed vendor MSI
-- fails its own deferred DeprovisionSparsePackage custom action during an
-- unattended LocalSystem removal. Isolated lifecycle QA received MSI 1603 and
-- confirmed that the exact ARP entry, service, and payload remained installed.
-- Do not present the package as managed-removable until the vendor ships a
-- verifiable unattended deprovision lifecycle.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Firezone.Client.GUI',
  'unsupported_managed_uninstall',
  'Firezone installs silently, but its current signed MSI fails its sparse-package deprovision custom action during unattended LocalSystem removal and leaves the application installed.',
  'https://github.com/firezone/firezone/blob/gui-client-1.5.16/rust/gui-client/src-tauri/win_files/sparse-package.wxs'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Firezone.Client.GUI';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Firezone.Client.GUI'
  and status in ('queued', 'failed');
