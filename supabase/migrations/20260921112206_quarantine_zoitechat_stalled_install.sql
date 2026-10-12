-- Exact failed payload; no app-wide restriction or malware classification.
-- Evidence and primary sources: docs/qa-zoitechat-20260921.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'ZoiteChat.ZoiteChat', '2.19.0', 'x64',
  'F3FABDAE2DC83A6AE2344DC1BCF1AD836C4FD4D5472D9B5E681C57CC8F972E08',
  'failed_managed_lifecycle',
  'LocalSystem PSADT run 35591226258 returned -1/1/60001/1. Install stalled with advertised Inno silent arguments, added no uninstall registration, and exact vendor removal found zero matches. VirusTotal was clean (0 malicious, 0 suspicious). Requires a reviewed unattended installation/removal contract and controlled strict exact-tuple retest before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal evidence, active work, and unrelated security blocks.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'ZoiteChat.ZoiteChat'
  and version = '2.19.0' and architecture = 'x64'
  and installer_sha256 = 'F3FABDAE2DC83A6AE2344DC1BCF1AD836C4FD4D5472D9B5E681C57CC8F972E08'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
