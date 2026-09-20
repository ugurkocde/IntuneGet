-- Exact-payload containment, not an app-wide or malicious-file verdict.
-- Candidate 7c4bc973-9b91-4e38-be57-33503f02686e; run 35495017154.
-- User-context PSADT returned 0/0/60001/0; exact FreSH registration remained
-- after the 310-second deadline. VirusTotal was not_found with null counts.
-- Release-tagged main.c routes /uninstall to an unconditional confirmation
-- menu and key wait. /silent selects installation, not unattended removal:
-- https://github.com/S42yt/FreSH/blob/v26.10.0/installation/main.c
-- https://github.com/S42yt/FreSH/blob/v26.10.0/installation/installer.c
-- WinGet declares user scope and /silent /user for this exact SHA:
-- https://github.com/microsoft/winget-pkgs/blob/master/manifests/s/S42yt/FreSH/26.10.0/S42yt.FreSH.installer.yaml
-- Existing shared QA/customer gates reject this tuple even with QA override.
-- Release requires reviewed managed removal, verified reputation, and a strict
-- controlled retest. Future corrected vendor releases remain eligible.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'S42yt.FreSH', '26.10.0', 'x64',
  '8EB1FE8DBDAF3B36F6E77A50D0E8726018CC740D4513D46CAF42BE575BFBCAE1',
  'failed_managed_lifecycle',
  'Isolated PSADT run 35495017154 returned 0/0/60001/0 in user context. Exact FreSH registration remained after the uninstall deadline. Release-tagged vendor source requires interactive confirmation for removal; /silent selects installation. VirusTotal reputation was unverified (not_found, null counts). Requires reviewed managed removal, verified reputation and a controlled strict retest before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal evidence, security findings and dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'S42yt.FreSH'
  and version = '26.10.0' and architecture = 'x64'
  and installer_sha256 = '8EB1FE8DBDAF3B36F6E77A50D0E8726018CC740D4513D46CAF42BE575BFBCAE1'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
