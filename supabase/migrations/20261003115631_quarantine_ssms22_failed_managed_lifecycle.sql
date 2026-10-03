-- Exact-payload compatibility hold; evidence: docs/qa-ssms22-20261003.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Microsoft.SQLServerManagementStudio.22', '22.10.2', 'x64',
  'E7B3885D3A0FEBB83B7A5CB155EFD8410A9A651A1BE16EAAA35D594C4D1D75D2',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 37119022165 returned 60001/1/60001/1. Product content was installed, but no unambiguous vendor uninstall identity was captured; uninstall found zero exact configured-name matches. Root cause unresolved because the install exception is absent from accessible bounded telemetry. Exact-payload compatibility hold only; release requires reviewed shared remediation or verified vendor remedy and a controlled strict exact-tuple retest. VirusTotal was clean 0/0; this is not a malware verdict.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Microsoft.SQLServerManagementStudio.22'
  and version = '22.10.2' and architecture = 'x64'
  and installer_sha256 = 'E7B3885D3A0FEBB83B7A5CB155EFD8410A9A651A1BE16EAAA35D594C4D1D75D2'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
