-- Exact-payload compatibility hold; evidence: docs/qa-powerbi-20261001.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Microsoft.PowerBI', '2.158.1177.0', 'x64',
  '4924187834D34605C3046F01B876FBA6A2CF36F864C36D16FD52C3F17A21009C',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 36849592959 returned 0/0/60001/0. Exact registered Burn uninstall /uninstall /quiet /norestart did not remove registration {dc5665fe-ff39-46c4-8b41-8cd1b870c0c1} before the bounded completion deadline; final package detection remained positive. Root cause unresolved. Release requires reviewed shared remediation and controlled strict exact-tuple retest. VirusTotal was not_found, not a clean 0/0 verdict; this hold is not a malware verdict.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve failed evidence and any dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Microsoft.PowerBI'
  and version = '2.158.1177.0' and architecture = 'x64'
  and installer_sha256 = '4924187834D34605C3046F01B876FBA6A2CF36F864C36D16FD52C3F17A21009C'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
