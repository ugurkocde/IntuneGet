-- Read-only current-pin cohort audit. Status-only qa-status.mjs is not enough.
with strict as (
  select c.*, r.packager_commit
  from public.qa_candidates c
  join public.qa_package_results r
    on r.package_profile_sha256 = c.package_profile_sha256
   and r.installer_sha256 = c.installer_sha256
   and lower(r.winget_id) = lower(c.winget_id)
   and r.tested_version = c.version
   and r.architecture = c.architecture
  where c.status = 'passed' and c.test_level = 'psadt-package'
    and r.outcome = 'Passed'
    and r.phase_results->'install'->>'exitCode' = '0'
    and r.phase_results->'detectionAfterInstall'->>'exitCode' = '0'
    and r.phase_results->'uninstall'->>'exitCode' = '0'
    and r.phase_results->'detectionAfterUninstall'->>'exitCode' = '1'
    and r.environment->>'executionContext' = 'LocalSystem'
    and r.virustotal_malicious = 0 and r.virustotal_suspicious = 0
    and (c.test_config->>'packageProfileCanonicalJson')::jsonb
        ->'toolchain'->>'packagerCommit' = r.packager_commit
)
select count(distinct lower(trim(c.winget_id))) strict_count,
       max(c.finished_at) latest_strict_finish
from strict c
where c.finished_at > timestamptz '2026-08-30T08:28:35Z'
  and c.packager_commit = (
    select required_packager_commit from public.qa_pipeline_control where id = 'global'
  )
  and not exists (
    select 1 from strict h
    where lower(trim(h.winget_id)) = lower(trim(c.winget_id))
      and h.finished_at <= timestamptz '2026-08-30T08:28:35Z'
  )
  and not exists (
    select 1 from public.package_eligibility_blocks b
    where lower(b.winget_id) = lower(c.winget_id)
  )
  and not exists (
    select 1 from public.curated_excluded_apps b
    where lower(b.winget_id) = lower(c.winget_id)
  )
  and not exists (
    select 1 from public.qa_package_blocks b
    where b.winget_id = c.winget_id and b.version = c.version
      and b.architecture = c.architecture and b.installer_sha256 = c.installer_sha256
  );
