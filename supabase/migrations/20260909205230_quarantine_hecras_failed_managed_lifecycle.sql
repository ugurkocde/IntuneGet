-- Reviewed exact-payload quarantine, not a claim that all HEC-RAS releases
-- lack unattended support. Run 33533285860 used the current shared packager
-- d33825c2b786af7c3f22f4b828108c4129299ef9 and returned 60001/1/0/1.
-- Published sanitized evidence proves exact MSI removal succeeded, but the
-- install exception is unavailable to this operator. Do not guess switches,
-- synthesize detection, or call this a VirusTotal finding (verdict was 0/0).
-- Remove this reviewed block only after diagnosis and a controlled strict
-- lifecycle retest; newer versions and changed payloads remain eligible.

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
    'unreviewed_dependency',
    'failed_managed_lifecycle'
  ));

insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'HydrologicEngineeringCenter.HEC-RAS', '7.0', 'x86',
  '166CA2458830C7646ECACD542C40C07E5DA7E48138BD81DA4EBEBD7B5C2A9532',
  'failed_managed_lifecycle',
  'Reviewed quarantine: isolated LocalSystem PSADT run 33533285860 returned install 60001, install detection 1, uninstall 0, removal detection 1. Exact MSI removal succeeded, but install validation failed. Root exception remains unverified; this payload requires diagnosis and controlled strict retest before release. VirusTotal was clean (0/0).'
)
on conflict (winget_id, version, architecture, installer_sha256) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    updated_at = now();
