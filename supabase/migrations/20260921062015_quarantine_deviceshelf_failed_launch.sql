-- Exact failed installer payload, not an app-wide or malware classification.
-- Evidence and primary sources: docs/qa-deviceshelf-20260921.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'ChristofMueller.DeviceShelf', '1.9.30', 'x64',
  '4741C1AAD4F058939CAE5A3311E46D9C9F4E3BFAC7BC03F56F582F18C6B5029E',
  'failed_managed_lifecycle',
  'Isolated user-context PSADT runs 35566418213 and 35566946668 returned 60001/1/60001/1. The advertised /S installer launch failed with a shell cancellation exception before product registration; exact uninstall resolution found zero matches. VirusTotal was clean (0 malicious, 0 suspicious). Requires a reviewed unattended install/removal contract and a controlled strict exact-tuple retest before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal evidence, dispatched work, and unrelated security blocks.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'ChristofMueller.DeviceShelf'
  and version = '1.9.30' and architecture = 'x64'
  and installer_sha256 = '4741C1AAD4F058939CAE5A3311E46D9C9F4E3BFAC7BC03F56F582F18C6B5029E'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
