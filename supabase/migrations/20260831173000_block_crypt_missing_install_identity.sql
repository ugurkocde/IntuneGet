-- Crypt 1.6.0's Inno wrapper exits successfully but creates no authoritative
-- Crypt uninstall registration. Isolated LocalSystem QA observed only a
-- WebView2 runtime registration change, so the shared packager cannot prove
-- that Crypt installed or remove it safely. Keep this immutable payload out
-- of QA and customer packaging without disabling a future vendor release
-- that exposes a complete managed lifecycle.

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
  'TheCryptTeam.Crypt',
  '1.6.0',
  'x64',
  '816DE63CB4F8E09C76B932EED6E92577CFCF97BD8FA9D29937BE88EBA49C9CC5',
  'missing_authoritative_install_identity',
  'The exact Inno payload exits successfully but creates no authoritative Crypt install or uninstall registration; only a WebView2 runtime registration changes, so install verification and safe removal are impossible.'
)
on conflict (winget_id, version, architecture, installer_sha256) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    observed_at = now(),
    updated_at = now();
