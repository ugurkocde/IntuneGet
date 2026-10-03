-- Exact-payload compatibility hold; evidence: docs/qa-edge150-20261003.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Microsoft.Edge', '150.0.4078.65', 'x64',
  '037340DC31DC0D2DD6C0D7E7627064B3F34B03656D37A7CAB499F4E8A1697882',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 37123600899 returned 1603/1/60001/1. Standard quiet MSI installation failed and no exact vendor uninstall identity was captured. Root cause unresolved in accessible bounded telemetry. Exact-payload compatibility hold only; release requires reviewed shared remediation or verified vendor remedy and controlled strict exact-tuple retest. VirusTotal was clean 0/0; this is not a malware verdict.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Microsoft.Edge'
  and version = '150.0.4078.65' and architecture = 'x64'
  and installer_sha256 = '037340DC31DC0D2DD6C0D7E7627064B3F34B03656D37A7CAB499F4E8A1697882'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
