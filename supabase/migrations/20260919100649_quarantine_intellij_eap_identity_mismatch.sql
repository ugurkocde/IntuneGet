-- Exact-payload containment shared by QA demand and customer packaging.
-- Candidate 22702819-b023-4741-a133-85d568262513; run 35435222208.
-- PSADT/LocalSystem returned 60001/1/60001/1. Vendor install itself returned 0,
-- but registered IntelliJ IDEA 2025.2.2 (version 252.26199.7, JetBrains s.r.o.)
-- instead of the manifest key IntelliJ IDEA 252.26199.7. Capture/removal
-- correctly refused the mismatch. VirusTotal was not_found, not clean 0/0.
-- Official manifest: https://github.com/microsoft/winget-pkgs/blob/master/manifests/j/JetBrains/IntelliJIDEA/Ultimate/EAP/252.26199.7/JetBrains.IntelliJIDEA.Ultimate.EAP.installer.yaml
-- Release requires a reviewed identity correction AND clean reputation evidence;
-- never loosen identity selection or manufacture a successful lifecycle.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'JetBrains.IntelliJIDEA.Ultimate.EAP', '252.26199.7', 'x64',
  'F6DB9893CC39CF217788A24BBA5C375C332FA354F8BE57F6121BED1FC070F802',
  'failed_managed_lifecycle',
  'Isolated PSADT run 35435222208 returned 60001/1/60001/1 under LocalSystem. Manifest key IntelliJ IDEA 252.26199.7 was absent; vendor registered IntelliJ IDEA 2025.2.2 with version 252.26199.7. Exact identity capture and safe removal failed. VirusTotal was not_found. Requires reviewed identity correction, clean reputation evidence, and controlled strict retest before release.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal failure evidence, security findings, and dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'JetBrains.IntelliJIDEA.Ultimate.EAP'
  and version = '252.26199.7' and architecture = 'x64'
  and installer_sha256 = 'F6DB9893CC39CF217788A24BBA5C375C332FA354F8BE57F6121BED1FC070F802'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
