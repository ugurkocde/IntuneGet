-- Exact-payload containment, not an app-wide or security verdict.
-- Candidate 90e10b9f-cd5a-482a-af05-2ba88402b19a; run 35367814228.
-- https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/35367814228
-- PSADT 4.1.8 / LocalSystem / bc329cb8bfafd8d2af940bdc9f8ccf044ac15146.
-- Install/detect/uninstall/removal: 0/0/60001/0. VirusTotal: 0/0.
-- The captured Program Files (x86)\TubeDigger\unins000.exe received
-- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-, exited 1, and retained
-- exact registration {1E3745C1-674D-4B2E-B8F7-3F4088950ED7}_is1 after 310s.
-- WinGet identifies these bytes as Inno:
-- https://github.com/microsoft/winget-pkgs/blob/master/manifests/t/TubeDigger/TubeDigger/8.2.5.0/TubeDigger.TubeDigger.installer.yaml
-- https://jrsoftware.org/ishelp/topic_uninstcmdline.htm documents the quiet
-- switches already used. No evidence establishes a safe corrective adapter.
-- Retain this hold until reviewed diagnosis and a controlled strict retest.
-- Existing shared QA/customer gates enforce it; other payloads stay eligible.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'TubeDigger.TubeDigger', '8.2.5.0', 'x86',
  'D34F1AFFD65BCF99F5762F5FC1A13C0B2585546BDC89D99AA045364DA6215BC8',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35367814228 returned 0/0/60001/0. The exact registered Inno uninstaller exited 1 with quiet arguments and retained registration {1E3745C1-674D-4B2E-B8F7-3F4088950ED7}_is1 after the 310-second deadline. Requires reviewed diagnosis and a controlled strict retest before release. VirusTotal was clean (0/0).'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal failures, security evidence, and already-dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'TubeDigger.TubeDigger'
  and version = '8.2.5.0' and architecture = 'x86'
  and installer_sha256 = 'D34F1AFFD65BCF99F5762F5FC1A13C0B2585546BDC89D99AA045364DA6215BC8'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
