-- DirPrintOK documents unattended installation with `-install /silent`, but
-- its official support material does not document an unattended uninstall:
-- https://www.softwareok.com/?faq=13&seite=faq-DirPrintOK
-- https://www.softwareok.com/?faq=0&seite=faq-DirPrintOK
-- In an isolated LocalSystem lifecycle run, the exact registered command
-- `DirPrintOK.exe -uninstall /silent` returned exit code 1, printed
-- `Press any key to exit...`, and left the exact DirPrintOK registration
-- installed for the full bounded five-minute completion wait. This matches the
-- unsupported removal behavior already established for the same vendor's
-- DesktopOK and Q-Dir products. Do not publish a PSADT package without a
-- supported, unattended managed-removal contract.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'SoftwareOK.DirPrintOK',
  'unsupported_managed_uninstall',
  'DirPrintOK installs unattended, but its exact registered removal command failed under LocalSystem. The vendor process returned exit code 1, printed Press any key to exit, and left the exact DirPrintOK registration installed for the full bounded five-minute wait; the vendor does not document a supported unattended uninstall contract.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/33226086539'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'SoftwareOK.DirPrintOK';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'SoftwareOK.DirPrintOK'
  and status in ('queued', 'failed', 'error');
