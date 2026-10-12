-- SQL Server Express is a configurable server workload rather than a generic
-- desktop application. Microsoft requires unattended setup to choose the
-- features or role, instance identity, and SQL sysadmin accounts explicitly:
-- https://learn.microsoft.com/en-us/sql/database-engine/install-windows/install-sql-server-from-the-command-prompt
-- The current WinGet bootstrapper omits that deployment-specific contract. In
-- isolated LocalSystem lifecycle QA its exact manifest command exited -1,
-- created no SQL Server instance or unambiguous ARP identity, and therefore
-- exposed no safe generic uninstall target. Do not guess customer SQL security
-- or instance settings in automated packaging.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Microsoft.SQLServer.2017.Express',
  'unsupported_managed_install',
  'SQL Server 2017 Express requires deployment-specific feature, instance, and SQL administrator configuration. Its exact WinGet bootstrapper command exits -1 under LocalSystem, creates no SQL instance or unambiguous uninstall identity, and cannot provide a safe generic managed lifecycle.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32536238628'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Microsoft.SQLServer.2017.Express';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Microsoft.SQLServer.2017.Express'
  and status in ('queued', 'failed', 'error');
