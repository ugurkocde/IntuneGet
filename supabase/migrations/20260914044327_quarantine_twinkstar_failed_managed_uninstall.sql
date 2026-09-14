-- Exact-payload containment: candidate 76f3ec00-7b2f-4837-8cda-1f7a808030cd.
-- https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34805736085
-- PSADT 4.1.8 / LocalSystem / pin 9e51c9ab6cc3a28346f13266e566c9896fa4101b.
-- Tuple 0/0/60001/0: captured Twinkstar registration remained after 310s.
-- Registered Program Files\Twinkstar Browser\Uninstall.exe had no quiet
-- command; /S exited without removing the exact registration.
-- Official WinGet manifest documents -silent for INSTALL only:
-- https://github.com/microsoft/winget-pkgs/blob/master/manifests/t/Twinkstar/TwinkstarBrowser/11.4.1000.2609/Twinkstar.TwinkstarBrowser.installer.yaml
-- Vendor site https://www.twinkstar.com/ provides no established unattended
-- removal contract. Do not guess switches or manufacture removal by deletion.
-- Compatibility containment, not a security verdict: VirusTotal was 0/0.
-- Shared QA/customer gates enforce this tuple; future releases remain eligible.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Twinkstar.TwinkstarBrowser', '11.4.1000.2609', 'x64',
  '3671D4C0693240501854274692724B9A98C35B1E869066CF40985F43D4738668',
  'failed_managed_lifecycle',
  'Isolated PSADT run 34805736085 returned 0/0/60001/0 under LocalSystem. The exact registered Uninstall.exe /S command exited but retained registration Twinkstar after the 310-second deadline. No supported unattended removal contract was established. Requires reviewed managed removal and a controlled strict retest before release. VirusTotal was clean (0/0).'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal failure/security evidence and any dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Twinkstar.TwinkstarBrowser'
  and version = '11.4.1000.2609' and architecture = 'x64'
  and installer_sha256 = '3671D4C0693240501854274692724B9A98C35B1E869066CF40985F43D4738668'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
