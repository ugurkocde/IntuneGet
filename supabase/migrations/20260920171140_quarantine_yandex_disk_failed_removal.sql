-- Exact failed EXE payload; not an app-wide exclusion or malware verdict.
-- Evidence and primary sources: docs/qa-yandex-disk-20260920.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Yandex.Disk', '3.2.51.5198', 'x64',
  '07B333208A5C14F18A8B48C99478D53DD39368D1E66D6EEB2DD44CB0F545FFAA',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35523663976 returned 0/0/60001/0. The exact YandexDisk2 registration remained after the registered vendor removal command and the bounded completion deadline. VirusTotal was clean (0 malicious, 0 suspicious). Requires a reviewed unattended EXE removal contract and a controlled strict retest before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve failed evidence, unrelated quarantines, and dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Yandex.Disk'
  and version = '3.2.51.5198' and architecture = 'x64'
  and installer_sha256 = '07B333208A5C14F18A8B48C99478D53DD39368D1E66D6EEB2DD44CB0F545FFAA'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
