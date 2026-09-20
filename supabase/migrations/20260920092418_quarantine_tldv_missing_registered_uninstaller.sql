-- Exact-payload containment, not an app-wide or malicious-file verdict.
-- Candidate fbe6eab7-0934-453e-840a-aa114273f226; run 35501735657.
-- The reviewed exact-key adapter repaired identity capture. Its LocalSystem
-- retest installed/detected but the captured vendor uninstaller was absent.
-- Keep the correct identity adapter; do not guess paths or delete vendor files.
-- Manifest: https://github.com/microsoft/winget-pkgs/blob/master/manifests/t/tldx/tldv/3.0.264/tldx.tldv.installer.yaml
-- Vendor removal guide documents Control Panel and following onscreen prompts:
-- https://intercom.help/tldv/en/articles/14433922-record-meetings-on-any-platform-with-or-without-a-bot-tl-dv-desktop-app
-- Existing shared customer/QA gates enforce this exact tuple, including QA
-- overrides. Release only after reviewed diagnosis and a controlled strict retest.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'tldx.tldv', '3.0.264', 'x64',
  'BB5007C2BF94F717428D5982CF739489CB0BD0CAFD1A193DA671304AD421B25C',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35501735657 captured the verified NSIS identity and completed install/detection, but uninstall failed because the registered vendor uninstaller was not found. Managed removal remains unverified. Requires reviewed diagnosis and a controlled strict retest of these exact bytes before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal failures, security findings, and dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'tldx.tldv'
  and version = '3.0.264' and architecture = 'x64'
  and installer_sha256 = 'BB5007C2BF94F717428D5982CF739489CB0BD0CAFD1A193DA671304AD421B25C'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
