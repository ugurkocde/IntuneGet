-- The vendor's Windows deployment script exits without a deployment token:
-- https://github.com/Zorus/ZorusDeploymentScripts/blob/main/scripts/windows/InstallScript.ps1
-- Generic WinGet defaults contain no ARCHON_TOKEN. Isolated LocalSystem run
-- 35606172558 installed two Archon Agent registrations but could not capture
-- the configured Zorus Archon Agent identity (60001/1/60001/1). A name alias
-- alone would not provision this tenant-bound filtering service. Refuse the
-- generic catalog path in both QA and customer packaging; do not pass tenant
-- secrets into QA or guess removal commands. Custom customer sources remain
-- separate from catalog eligibility.
insert into public.package_eligibility_blocks (winget_id, block_code, detail, source_url)
values (
  'ZorusInc.ArchonAgent',
  'unsupported_managed_install',
  'The vendor requires ARCHON_TOKEN for provisioned deployment. The generic catalog profile supplies no deployment token and failed exact managed identity capture and removal in isolated LocalSystem QA. Tenant provisioning is not supported by the generic catalog package.',
  'https://github.com/Zorus/ZorusDeploymentScripts/blob/main/scripts/windows/InstallScript.ps1'
)
on conflict (winget_id) do update
set block_code = excluded.block_code, detail = excluded.detail,
    source_url = excluded.source_url, updated_at = now();

update public.curated_apps set is_verified = false
where winget_id = 'ZorusInc.ArchonAgent';

-- Never modify active work or successful history.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'ZorusInc.ArchonAgent'
  and status in ('queued', 'failed', 'error');
