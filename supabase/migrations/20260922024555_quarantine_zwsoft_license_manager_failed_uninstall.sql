-- Exact compatibility quarantine; evidence: docs/qa-zwlicense-20260922.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'ZWSOFT.NetworkLicenseManager', '1.3.10', 'x64',
  '89D5794BF27134E3EBD985B36BCA951D7608C69383F6A420597CE794B2699D63',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35679237885 returned 0/0/60001/0. The captured vendor Uninstall.exe exited without removing exact registration {B53D2C4E-E455-4441-B2D2-539C6D889782} within 310 seconds. VirusTotal was 0 malicious and 0 suspicious. Release requires a reviewed unattended removal contract and a controlled strict exact-tuple retest.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve failed evidence, dispatched work, and unrelated security blocks.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'ZWSOFT.NetworkLicenseManager'
  and version = '1.3.10' and architecture = 'x64'
  and installer_sha256 = '89D5794BF27134E3EBD985B36BCA951D7608C69383F6A420597CE794B2699D63'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
