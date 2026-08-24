-- DesktopOK documents unattended installation with /silent -?install, but its
-- removal guidance only covers interactive Control Panel/application-menu
-- removal or manually deleting the portable executable:
-- https://www.softwareok.com/?faq=37&seite=faq-DesktopOK
-- https://www.softwareok.com/?page=Windows%2FInfo%2FDesktopOK%2F23
-- https://www.softwareok.com/?faq=11&seite=faq-DesktopOK
-- The registered -?uninstall command failed generically under LocalSystem. A
-- guessed /silent -?uninstall adapter then failed under both user and machine
-- scopes. Across all three isolated lifecycle runs, installation and detection
-- succeeded but the exact DesktopOK registration remained after uninstall.
-- Do not publish a PSADT package whose managed removal contract is unsupported.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'SoftwareOK.DesktopOK',
  'unsupported_managed_uninstall',
  'DesktopOK installs unattended, but the registered vendor removal command and the guessed silent variant failed in three isolated lifecycle runs across user and machine scopes. The exact DesktopOK registration remained after every uninstall attempt, and the vendor does not document an unattended removal contract.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32747225410'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'SoftwareOK.DesktopOK';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'SoftwareOK.DesktopOK'
  and status in ('queued', 'failed', 'error');
