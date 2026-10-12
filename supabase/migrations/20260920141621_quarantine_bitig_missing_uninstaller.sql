-- Exact failed payload; not an app-wide exclusion or malware verdict.
-- Evidence and primary sources: docs/qa-bitig-20260920.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Bitig.Bitig', '1.0.4', 'x64',
  '1D6FBF4139EDF32FA66FC2D72151801D8D622760FAE71985A6C1167F47EFFCFF',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35515041627 returned 0/0/60001/0. The registered vendor uninstaller was absent beneath the SYSTEM profile and removal detection remained positive. VirusTotal reputation was unverified (not_found, null counts). Requires reviewed diagnosis, verified reputation, and a controlled strict retest before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve failed evidence, unrelated quarantines, and dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Bitig.Bitig'
  and version = '1.0.4' and architecture = 'x64'
  and installer_sha256 = '1D6FBF4139EDF32FA66FC2D72151801D8D622760FAE71985A6C1167F47EFFCFF'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
