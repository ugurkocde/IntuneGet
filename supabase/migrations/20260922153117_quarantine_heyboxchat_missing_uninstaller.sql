-- Exact compatibility quarantine; evidence: docs/qa-heyboxchat-20260922.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Qingfeng.HeyboxChat', '1.58.0', 'x64',
  'C32F3FB488EC5B1FBD046DCE3098719DF2F20C270020A8F692941D5DC686DC55',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35745461887 returned 0/0/60001/0, reproducing the missing registered uninstaller from run 35742782796. Captured registration HeyboxChat points to a missing uninstall.exe under the SYSTEM profile. VirusTotal was not_found, not a clean 0/0 verdict. Release requires a reviewed managed-removal contract and controlled strict exact-tuple retest including clean security evidence.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve failed evidence, active work, and unrelated security quarantines.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Qingfeng.HeyboxChat'
  and version = '1.58.0' and architecture = 'x64'
  and installer_sha256 = 'C32F3FB488EC5B1FBD046DCE3098719DF2F20C270020A8F692941D5DC686DC55'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
