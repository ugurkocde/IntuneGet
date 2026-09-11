-- Exact current-pin evidence audit. The guardian status-only counter is broader.
with strict as (
  select c.winget_id, c.finished_at, c.version, c.architecture,
         c.installer_sha256, r.packager_commit
  from public.qa_candidates c
  join public.qa_package_results r
    on r.package_profile_sha256 = c.package_profile_sha256
   and r.installer_sha256 = c.installer_sha256
   and r.winget_id = c.winget_id
   and r.tested_version = c.version
   and r.architecture = c.architecture
  where c.status = 'passed' and c.test_level = 'psadt-package'
    and r.outcome = 'Passed'
    and r.phase_results#>>'{install,exitCode}' = '0'
    and r.phase_results#>>'{detectionAfterInstall,exitCode}' = '0'
    and r.phase_results#>>'{uninstall,exitCode}' = '0'
    and r.phase_results#>>'{detectionAfterUninstall,exitCode}' = '1'
    and r.environment->>'executionContext' = 'LocalSystem'
    and r.virustotal_malicious = 0 and r.virustotal_suspicious = 0
    and r.packager_commit = ((c.test_config->>'packageProfileCanonicalJson')::jsonb#>>'{toolchain,packagerCommit}')
), historical as (
  -- Older compact-result rows may lack phase/context evidence. Conservatively
  -- exclude every recorded historical pass rather than count uncertain IDs.
  select distinct lower(trim(winget_id)) id from public.qa_candidates
  where status = 'passed' and test_level = 'psadt-package'
    and finished_at <= '2026-08-30T08:28:35Z'
)
select count(distinct lower(trim(s.winget_id))) strict_count,
       max(s.finished_at) latest_strict_finish
from strict s
where s.finished_at > '2026-08-30T08:28:35Z'
  and s.packager_commit = (select required_packager_commit from public.qa_pipeline_control where id = 'global')
  and not exists (select 1 from historical h where h.id = lower(trim(s.winget_id)))
  and not exists (select 1 from public.package_eligibility_blocks b where lower(b.winget_id) = lower(s.winget_id))
  and not exists (select 1 from public.qa_package_blocks b where b.winget_id = s.winget_id
    and b.version = s.version and b.architecture = s.architecture and b.installer_sha256 = s.installer_sha256);
