-- Retoolkit 2023.05 is declared machine-scope by WinGet, but its official
-- Inno package uses a per-user installation root. Under Intune's LocalSystem
-- context the exact x64 payload therefore installs below the SYSTEM profile
-- instead of providing a usable machine-wide application. Its large nested
-- component bundle also kept the vendor process active beyond the reviewed
-- 15-, 30-, and 45-minute ceilings in isolated runs 33428216044,
-- 33434832863, and 33441897643. Keep only this immutable release out of QA
-- and customer packaging so a corrected future release remains eligible.

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
  'mentebinaria.retoolkit',
  '2023.05',
  'x64',
  '1EB3511E8B816641D3EE6686BFC61329B54532BFD5CD8A65AA20F154EE55D120',
  'machine_scope_system_profile_install',
  'The exact Inno payload is declared machine-scope but installs below the LocalSystem profile and its nested vendor installer does not complete within the reviewed 45-minute ceiling, so it cannot provide a usable machine-wide Intune lifecycle.'
)
on conflict (winget_id, version, architecture, installer_sha256) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    observed_at = now(),
    updated_at = now();
