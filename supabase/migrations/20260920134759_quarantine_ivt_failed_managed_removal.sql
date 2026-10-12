-- Exact failed payload; not an app-wide exclusion or malware verdict.
-- Evidence and primary sources: docs/qa-ivt-20260920.md.
-- Preserve the failed result, unrelated quarantines, and dispatched work.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'BearStarSoftware.IVTSecureAccessFreeEdition', '28.1', 'x64',
  '8159B07F65735968EB3D14D34A19640B7C1E0084A41BC6189C542D1DC9B76FA2',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35513412236 returned 0/0/60001/0. Exact Inno registration {7441F521-47ED-4C88-AB90-8B41AC120CF6}_is1 remained after the 310-second uninstall deadline and removal detection remained positive. VirusTotal reputation was unverified (not_found, null counts). Requires reviewed diagnosis, verified reputation, and a controlled strict retest before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'BearStarSoftware.IVTSecureAccessFreeEdition'
  and version = '28.1' and architecture = 'x64'
  and installer_sha256 = '8159B07F65735968EB3D14D34A19640B7C1E0084A41BC6189C542D1DC9B76FA2'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
