-- Kangaroo Multiple 9.7.1.801 is declared as a machine-scope Nullsoft
-- installer, but isolated LocalSystem QA proved that the exact payload
-- registers its primary application below the SYSTEM profile and records an
-- uninstall executable that does not exist. The payload therefore cannot
-- satisfy a usable, removable machine-wide Intune lifecycle. Keep only this
-- immutable release out of QA and customer packaging; a corrected future
-- release remains independently eligible.

alter table public.qa_package_blocks
  drop constraint if exists qa_package_blocks_block_code_check;

alter table public.qa_package_blocks
  add constraint qa_package_blocks_block_code_check
  check (block_code in (
    'user_scope_machine_dependencies',
    'user_scope_elevation_required',
    'machine_scope_system_profile_install',
    'trusted_installer_tuple_unavailable',
    'unsupported_dependency_shape',
    'expired_signing_certificate',
    'unreviewed_dependency'
  ));

insert into public.qa_package_blocks (
  winget_id,
  version,
  architecture,
  installer_sha256,
  block_code,
  detail
)
values (
  'Taozuhong.KangarooMultiple',
  '9.7.1.801',
  'x64',
  'EFFD25236CD45111EB28E075C2AF4CD1CF9DEF23B9DEB2F728B355D8C62710E2',
  'machine_scope_system_profile_install',
  'The vendor declares a machine-scope Nullsoft install, but the exact payload registers its primary application below the LocalSystem profile and references a missing uninstaller, so it cannot satisfy a machine-wide Intune lifecycle.'
)
on conflict (winget_id, version, architecture, installer_sha256) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    observed_at = now(),
    updated_at = now();
