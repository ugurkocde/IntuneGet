-- Divoom Gateway 0.1.42.0 is distributed as an MSIX whose signing
-- certificate is outside its validity period. Windows provisioning rejects
-- the exact vendor payload with CERT_E_EXPIRED (0x800B0101). Keep this
-- immutable release out of QA and customer packaging without disabling a
-- future vendor release signed with a valid certificate.

alter table public.qa_package_blocks
  drop constraint if exists qa_package_blocks_block_code_check;

alter table public.qa_package_blocks
  add constraint qa_package_blocks_block_code_check
  check (block_code in (
    'user_scope_machine_dependencies',
    'user_scope_elevation_required',
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
  'r12f.DivoomGateway',
  '0.1.42.0',
  'x64',
  '3C76B4F9B0539A6C617E424A333F857B61402BD001FCECB8E325D0134CD3C16A',
  'expired_signing_certificate',
  'Windows rejected the vendor MSIX during isolated machine provisioning with CERT_E_EXPIRED (0x800B0101). The exact installer is blocked until the vendor publishes a newly signed release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    observed_at = now(),
    updated_at = now();
