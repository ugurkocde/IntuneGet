-- Y8 Browser 1.0.11 is an NSIS installer without an authoritative
-- machine-scope contract. Isolated LocalSystem QA installed the exact x86
-- payload below the SYSTEM profile and captured its vendor uninstall entry,
-- but the registered Uninstall Y8 Browser.exe did not exist. The exact
-- lifecycle failed closed in run 33417125026 and cannot provide a usable,
-- removable machine-wide Intune deployment. Keep only this immutable release
-- out of QA and customer packaging so a corrected future release remains
-- independently eligible.

alter table public.qa_package_blocks
  drop constraint if exists qa_package_blocks_block_code_check;

alter table public.qa_package_blocks
  add constraint qa_package_blocks_block_code_check
  check (block_code in (
    'user_scope_machine_dependencies',
    'user_scope_elevation_required',
    'machine_scope_system_profile_install',
    'missing_authoritative_install_identity',
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
  'Y8Games.Y8Browser',
  '1.0.11',
  'x86',
  'AE0FA64D18AE2423939AC7015A2CC2F6BC781DAD57760B1FED60BD76609991C8',
  'machine_scope_system_profile_install',
  'The exact NSIS payload installs below the LocalSystem profile and registers a missing vendor uninstaller, so it cannot satisfy a usable and removable machine-wide Intune lifecycle.'
)
on conflict (winget_id, version, architecture, installer_sha256) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    observed_at = now(),
    updated_at = now();
