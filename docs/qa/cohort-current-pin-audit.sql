with evidence as (
select c.winget_id,c.finished_at,r.packager_commit,c.version,c.architecture,c.installer_sha256
from public.qa_candidates c join public.qa_package_results r
on r.package_profile_sha256=c.package_profile_sha256 and lower(r.winget_id)=lower(c.winget_id) and r.tested_version=c.version and r.architecture=c.architecture and upper(r.installer_sha256)=upper(c.installer_sha256)
where c.status='passed' and c.test_level='psadt-package' and c.test_config->>'mode'='psadt-package'
and upper(encode(extensions.digest(c.test_config->>'packageProfileCanonicalJson','sha256'),'hex'))=upper(c.package_profile_sha256)
and (c.test_config->>'packageProfileCanonicalJson')::jsonb->>'testLevel'='psadt-package'
and upper((c.test_config->>'packageProfileCanonicalJson')::jsonb#>>'{installer,sha256}')=upper(c.installer_sha256)
and r.outcome='Passed' and r.phase_results#>>'{install,exitCode}'='0'
and r.phase_results#>>'{detectionAfterInstall,exitCode}'='0'
and r.phase_results#>>'{uninstall,exitCode}'='0'
and r.phase_results#>>'{detectionAfterUninstall,exitCode}'='1'
and r.environment->>'executionContext'='LocalSystem'
and r.virustotal_malicious=0 and r.virustotal_suspicious=0
and (c.test_config->>'packageProfileCanonicalJson')::jsonb#>>'{toolchain,packagerCommit}'=r.packager_commit
), qualified as (
select e.* from evidence e cross join public.qa_pipeline_control p
where p.id='global' and e.finished_at > '2026-08-30T08:28:35Z'::timestamptz
and e.packager_commit=p.required_packager_commit and p.required_packager_commit=p.scheduler_packager_commit
and not exists (select 1 from evidence h where lower(h.winget_id)=lower(e.winget_id) and h.finished_at <= '2026-08-30T08:28:35Z'::timestamptz)
and not exists (select 1 from public.package_eligibility_blocks b where lower(b.winget_id)=lower(e.winget_id))
and not exists (select 1 from public.curated_excluded_apps b where lower(b.winget_id)=lower(e.winget_id))
and not exists (select 1 from public.qa_package_blocks b where lower(b.winget_id)=lower(e.winget_id) and b.version=e.version and b.architecture=e.architecture and upper(b.installer_sha256)=upper(e.installer_sha256))
) select count(distinct lower(trim(winget_id))) strict_count,max(finished_at) latest_strict_finish from qualified;
