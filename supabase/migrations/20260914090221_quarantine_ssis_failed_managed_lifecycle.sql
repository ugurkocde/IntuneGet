-- Exact-release compatibility quarantine; not a malware or app-wide verdict.
-- Candidate 55f1f2b6-cf19-46d3-ac18-f1666d9216ff / run 34824424792.
-- https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34824424792
-- PSADT 4.1.8, LocalSystem, pin 9e51c9ab6cc3a28346f13266e566c9896fa4101b.
-- Exact SHA and profile matched; VirusTotal 0/0. Tuple: 1626/1/60001/1.
-- Published PSADT telemetry confirms /quiet /norestart and an available MSI
-- mutex. Installation failed; exact Burn registration was absent on removal.
-- Do not interpret removal non-detection as a successful lifecycle.
-- Official WinGet metadata supplies those same switches and Burn product key:
-- https://github.com/microsoft/winget-pkgs/blob/master/manifests/m/Microsoft/DataTools/IntegrationServices/17.0.1010.2/Microsoft.DataTools.IntegrationServices.installer.yaml
-- Microsoft documents Visual Studio prerequisites, but the bounded evidence
-- does not establish the vendor root cause. No guessed adapter is justified.
-- https://learn.microsoft.com/en-us/sql/ssdt/ssis-vs2022-troubleshooting-guide
-- Existing shared customer and QA gates enforce this exact tuple, including
-- manual QA overrides. A reviewed fix and controlled strict retest are required
-- before releasing it. Other versions, architectures and payloads remain eligible.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Microsoft.DataTools.IntegrationServices', '17.0.1010.2', 'x86',
  '75D8444333303D5B449660A669AF07862289E5F2BBDEF0AE7520C5BA3E47D65B',
  'failed_managed_lifecycle',
  'Isolated PSADT run 34824424792 returned 1626/1/60001/1 under LocalSystem using the manifest /quiet /norestart switches. Install failed and exact Burn registration {36408e1e-deb6-47d8-bff0-37776bebac61} was absent. Vendor root cause is not established by bounded telemetry. Requires a reviewed managed lifecycle fix and controlled strict retest before release. VirusTotal was clean (0/0).'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal failure/security evidence and any dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Microsoft.DataTools.IntegrationServices'
  and version = '17.0.1010.2' and architecture = 'x86'
  and installer_sha256 = '75D8444333303D5B449660A669AF07862289E5F2BBDEF0AE7520C5BA3E47D65B'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
