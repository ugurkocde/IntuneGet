-- Exact-payload hold; evidence and release criteria: docs/qa-edge-20260930.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Microsoft.Edge', '154.0.4258.37', 'x64',
  '4D8D922C8B2470084A380142CDFD51B2B28A83AF7982D8F023CB8FACBF258246',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 36772802545 returned 1603/1/60001/1. MSI installation failed and no unambiguous vendor uninstall identity was captured. Root cause is unresolved; this is an exact-payload compatibility hold, not a malware verdict or app-wide unsupported claim. Release requires reviewed shared remediation and a controlled strict exact-tuple retest.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Keep failed evidence and active work intact.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Microsoft.Edge'
  and version = '154.0.4258.37' and architecture = 'x64'
  and installer_sha256 = '4D8D922C8B2470084A380142CDFD51B2B28A83AF7982D8F023CB8FACBF258246'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
