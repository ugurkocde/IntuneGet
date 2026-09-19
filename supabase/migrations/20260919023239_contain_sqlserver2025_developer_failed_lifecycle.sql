-- Exact-payload compatibility containment, not an app-wide or malware verdict.
-- Candidate 68b8058d-33b2-4eb2-b5bb-2effbf8bee2d; run 35415266877.
-- LocalSystem PSADT tuple -1/1/60001/1; VirusTotal malicious/suspicious 0/0.
-- The SSEI bootstrapper failed using the exact official WinGet quiet switches.
-- No ARP entry was added; removal correctly refused a missing exact identity.
-- Bounded telemetry does not establish the vendor root cause. Do not guess
-- SQL instance settings, change security context, or weaken managed removal.
-- https://github.com/microsoft/winget-pkgs/blob/master/manifests/m/Microsoft/SQLServer/2025/Developer/17.0.1000.7/Microsoft.SQLServer.2025.Developer.installer.yaml
-- https://learn.microsoft.com/en-us/sql/database-engine/install-windows/install-sql-server-from-the-command-prompt?view=sql-server-ver17
-- Existing QA demand and customer package gates enforce this immutable tuple.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Microsoft.SQLServer.2025.Developer', '17.0.1000.7', 'x64',
  'F2FDCEA621E29B2DD09E3802FD6FE7664A2037BED02349854CCAE96C4A03BBF1',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35415266877 returned -1/1/60001/1 using the published WinGet quiet switches. SSEI installation failed and no exact Microsoft SQL Server SQL2025 uninstall registration was found. Vendor root cause unresolved. Requires reviewed diagnosis and a controlled strict retest before release. VirusTotal malicious/suspicious was 0/0.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal failure/security evidence and any dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Microsoft.SQLServer.2025.Developer'
  and version = '17.0.1000.7' and architecture = 'x64'
  and installer_sha256 = 'F2FDCEA621E29B2DD09E3802FD6FE7664A2037BED02349854CCAE96C4A03BBF1'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
