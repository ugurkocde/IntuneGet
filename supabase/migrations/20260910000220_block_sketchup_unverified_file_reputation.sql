-- Exact-payload verification hold, not a malware finding or vendor-wide block.
-- Run 34418186636 repaired SketchUp's managed lifecycle (0/0/0/1), but its
-- protected hash lookup returned not_found, with no malicious/suspicious counts.
-- Release this tuple only after clean 0/0 reputation evidence is verified.
-- Future versions and changed payloads remain eligible through normal gates.
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
    'failed_managed_lifecycle',
    'unverified_file_reputation'
  ));

insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Trimble.SketchUp.2025', '25.0.660', 'x64',
  '0AB6635E4740F415FC102F4DE23E28F6DE95BF4085E84001791A17C5FCBF320E',
  'unverified_file_reputation',
  'Verification hold: shared PSADT LocalSystem run 34418186636 completed 0/0/0/1 on packager a27749fb895eaa142da413bb6b4b9ebaa5477ad4. VirusTotal returned not_found with null malicious/suspicious counts. Required clean 0/0 reputation evidence is unavailable. This is not a malware finding. Verify a clean report for this exact hash before releasing this tuple.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;
