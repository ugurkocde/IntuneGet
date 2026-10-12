-- Exact-payload hold; diagnosis and release contract: docs/qa-autodesk-access-20261003.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Autodesk.AutodeskAccess', '2.24.0.519', 'x64',
  '21DC225CD486CB56DBCDE7FB52B70D466C8E16C76FA08E1590CA0E2017FBCB33',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 37143458620 returned 0/-1/0/1; post-install detection timed out with stalled_no_activity. Exact Autodesk ODIS registration was captured and removed using the existing reviewed adapter. Detection root cause remains unresolved in bounded telemetry. Exact-payload compatibility hold across QA and customer packaging; release requires reviewed remediation and controlled strict exact-tuple retest. VirusTotal was not_found, not a clean verdict or malware verdict.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Autodesk.AutodeskAccess'
  and version = '2.24.0.519' and architecture = 'x64'
  and installer_sha256 = '21DC225CD486CB56DBCDE7FB52B70D466C8E16C76FA08E1590CA0E2017FBCB33'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
