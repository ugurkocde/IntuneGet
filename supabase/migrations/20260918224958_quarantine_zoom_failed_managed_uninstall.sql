-- Exact-payload compatibility hold; not an app-wide or security verdict.
-- Candidate 352e4d5c-af3d-445f-b035-5c015186df29; run 35401931306.
-- LocalSystem PSADT 4.1.8, pin bc329cb8bfafd8d2af940bdc9f8ccf044ac15146.
-- Install/detect/uninstall/removal 0/0/1601/0; VirusTotal 0/0.
-- The exact captured MSI product {e961cd8b-39eb-4a93-a78f-8008f27b17b9}
-- was passed to msiexec /x with REBOOT=ReallySuppress /QN.
-- Microsoft defines 1601 as ERROR_INSTALL_SERVICE_FAILURE:
-- https://learn.microsoft.com/en-us/windows/win32/msi/initialization-errors
-- Evidence does not distinguish a transient guest service failure from a
-- repeatable payload issue. Do not assert unsupported vendor uninstall or
-- introduce speculative service changes. Require diagnosis and a controlled
-- strict retest before releasing these bytes. Other payloads remain eligible.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Zoom.Zoom', '7.2.48358', 'x64',
  '132A59637FCFF4F0F01891F163A7726976D72A4DD7199EC4C0A224CB8E28D5D1',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35401931306 returned 0/0/1601/0. Uninstall of exact captured MSI product {e961cd8b-39eb-4a93-a78f-8008f27b17b9} failed because Windows Installer service could not be accessed; removal detection remained positive. Root cause unresolved. Requires reviewed diagnosis and a controlled strict retest before release. VirusTotal malicious/suspicious was 0/0.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal failure and any dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Zoom.Zoom'
  and version = '7.2.48358' and architecture = 'x64'
  and installer_sha256 = '132A59637FCFF4F0F01891F163A7726976D72A4DD7199EC4C0A224CB8E28D5D1'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
