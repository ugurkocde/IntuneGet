-- Exact failed payload; not an app-wide exclusion or a malware verdict.
-- Evidence and primary sources: docs/qa-pebrel-20260920.md.
-- Preserve the failed result, unrelated quarantines, and dispatched work.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Kuddev.Pebrel', '1.8.0', 'x64',
  '28FA2D4A0FFF3FA039CFFEF586875CB867020EB391DCD31BE3DB3477A8AE2159',
  'failed_managed_lifecycle',
  'Isolated PSADT run 35504284144 returned 0/0/60001/0. The exact Inno registration {61022144-7D0A-4E54-94F2-C329A8F58656}_is1 remained after the 310-second silent uninstall deadline. Vendor source specifies user scope and a setup-ai --remove uninstall action; the stalled action is not established. User-context execution and unverified VirusTotal reputation are not strict evidence. Requires reviewed repair and a controlled lifecycle retest before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Kuddev.Pebrel'
  and version = '1.8.0' and architecture = 'x64'
  and installer_sha256 = '28FA2D4A0FFF3FA039CFFEF586875CB867020EB391DCD31BE3DB3477A8AE2159'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
