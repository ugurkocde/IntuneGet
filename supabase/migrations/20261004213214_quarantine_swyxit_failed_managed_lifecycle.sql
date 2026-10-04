-- Exact-payload compatibility hold; evidence: docs/qa-swyxit-20261004.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Enreach.SwyxIt', '15.00.15188.0', 'x64',
  '0C5910234CA09725364A5A1A6958451AA22964B411F6F4CCA6CCAA4884C94AD8',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 37234274858 returned 1603/1/60001/1. Quiet MSI installation failed and no exact vendor uninstall registration was captured. Accessible bounded telemetry does not establish a safe repair. Exact-payload compatibility hold applies to QA and customer packages; release requires reviewed shared remediation or verified vendor remedy and controlled strict exact-tuple retest. VirusTotal was clean 0/0; this is not a malware verdict.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Enreach.SwyxIt'
  and version = '15.00.15188.0' and architecture = 'x64'
  and installer_sha256 = '0C5910234CA09725364A5A1A6958451AA22964B411F6F4CCA6CCAA4884C94AD8'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
