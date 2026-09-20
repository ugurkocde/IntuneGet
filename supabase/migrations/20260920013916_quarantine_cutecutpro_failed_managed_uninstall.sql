-- Exact-payload containment; not an app-wide or malicious-file verdict.
-- Candidate 72067baf-66ac-40aa-8208-005b0791a538; run 35481185271.
-- LocalSystem PSADT 4.1.8 returned install/detect/uninstall/removal 0/0/60001/0.
-- Sanitized PSADT telemetry: registered vendor uninstaller was not found.
-- VirusTotal was not_found with null counts, not a clean 0/0 result.
-- Release source declares electron-builder NSIS; no verified repair exists:
-- https://github.com/MDIsmatullah/CuteCut-Pro/blob/v2.4.2/package.json
-- https://github.com/microsoft/winget-pkgs/blob/master/manifests/c/CuteCutPro/CuteCutPro/2.4.2/CuteCutPro.CuteCutPro.installer.yaml
-- Existing shared customer/QA gates enforce this exact tuple, including when
-- a customer requests a QA override. Release only after reviewed diagnosis,
-- verified reputation, and a controlled strict retest of these exact bytes.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'CuteCutPro.CuteCutPro', '2.4.2', 'x64',
  '9F1F3547B1119054623B145FAAE7EC1C83BB833FE3D8C71A66C0AA5067203058',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35481185271 returned 0/0/60001/0. Sanitized PSADT telemetry reported that the registered vendor uninstaller was not found; removal detection remained positive. VirusTotal reputation was unverified (not_found, null counts). Requires reviewed diagnosis, verified reputation, and a controlled strict retest before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal failures, existing security findings and dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'CuteCutPro.CuteCutPro'
  and version = '2.4.2' and architecture = 'x64'
  and installer_sha256 = '9F1F3547B1119054623B145FAAE7EC1C83BB833FE3D8C71A66C0AA5067203058'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
