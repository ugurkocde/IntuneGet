-- Q-Dir documents unattended installation with `-install /silent`, but its
-- official support material does not document an unattended uninstall command:
-- https://www.softwareok.com/?faq=23&seite=faq-Q-DIR
-- https://www.softwareok.com/?faq=105&seite=faq-Q-DIR
-- In two isolated LocalSystem lifecycle runs, the exact registered Q-Dir
-- command already included `-uninstall /silent forall`. The process returned
-- exit code 1, printed `Press any key to exit...`, and left the exact Q-Dir
-- registration installed for the full bounded completion wait. The former
-- reviewed-argument adapter did not establish a working managed lifecycle.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'SoftwareOK.Q-Dir',
  'unsupported_managed_uninstall',
  'Q-Dir installs unattended, but its exact registered removal command failed in two isolated LocalSystem lifecycle runs. The vendor process returned exit code 1, printed Press any key to exit, and left the exact Q-Dir registration installed; the vendor does not document a supported unattended uninstall contract.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/33008768166'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'SoftwareOK.Q-Dir';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'SoftwareOK.Q-Dir'
  and status in ('queued', 'failed', 'error');
