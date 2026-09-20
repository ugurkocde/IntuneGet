-- Exact-payload containment, not an app-wide or malicious-file verdict.
-- Candidate 89b1452e-f7fd-4603-b66b-0e4ca0c1241d; run 35488295472.
-- User-context PSADT returned 60001/1/60001/1. LaunchAsync failed with
-- Win32Exception: "The operation was canceled by the user"; no exact
-- vendor uninstall registration was created. VirusTotal was not_found.
-- Official manifest declares user scope, NSIS /S and ProductCode ColorByte:
-- https://github.com/microsoft/winget-pkgs/blob/master/manifests/m/Meitu/ColorByte/Pro/7.9.4/Meitu.ColorByte.Pro.installer.yaml
-- Do not infer safe machine deployment from an elevation failure.
-- Release requires reviewed diagnosis, clean reputation and a strict retest.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Meitu.ColorByte.Pro', '7.9.4', 'x64',
  '7EAA434D370737369D4E8FF6B6680B0C8BB0DE9D630E0D59C1DC5ADD7E3B3CDF',
  'failed_managed_lifecycle',
  'Isolated PSADT run 35488295472 returned 60001/1/60001/1 in user context. Installer launch failed with a canceled-operation Win32Exception and no exact uninstall registration was created. Official WinGet metadata declares user scope. VirusTotal reputation was unverified (not_found, null counts). Requires reviewed diagnosis, verified reputation and a controlled strict retest before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal evidence, security findings and any dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Meitu.ColorByte.Pro'
  and version = '7.9.4' and architecture = 'x64'
  and installer_sha256 = '7EAA434D370737369D4E8FF6B6680B0C8BB0DE9D630E0D59C1DC5ADD7E3B3CDF'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
