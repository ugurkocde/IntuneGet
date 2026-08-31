-- StudioTrans 1.2.4 is a Nullsoft installer without an authoritative
-- machine-scope contract. Isolated LocalSystem QA proved that the exact
-- payload registers its primary application below the SYSTEM profile and
-- references an uninstall executable that does not exist. The payload cannot
-- satisfy a usable, removable machine-wide Intune lifecycle. Keep only this
-- immutable release out of QA and customer packaging so a corrected future
-- release remains independently eligible.

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
  'xinpianchang.StudioTrans',
  '1.2.4',
  'x64',
  '67E5BD9AB9774F386BFD4EBE06FC4A3F06EC00E0B8AF68A48FBF5CCB8E0ADD85',
  'machine_scope_system_profile_install',
  'The exact Nullsoft payload registers its primary application below the LocalSystem profile and references a missing uninstaller, so it cannot satisfy a usable and removable machine-wide Intune lifecycle.'
)
on conflict (winget_id, version, architecture, installer_sha256) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    observed_at = now(),
    updated_at = now();
