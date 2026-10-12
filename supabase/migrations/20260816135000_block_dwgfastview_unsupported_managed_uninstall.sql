-- DWG FastView 9.10 supports unattended installation, but its registered
-- setup.exe does not provide a reliable unattended removal lifecycle. Three
-- isolated LocalSystem runs tried the bare registered command and the two
-- plausible setup lifecycles (/silent /uninstall and /s /uninstall). Each
-- remained installed through the bounded five-minute completion check, and
-- independent detection still found the exact DWGFastView_en_ww registration.
-- Keep this package out of customer packaging and QA until the vendor publishes
-- a verified unattended uninstall contract.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Gstarsoft.DWGFastView',
  'unsupported_managed_uninstall',
  'DWG FastView supports unattended installation, but its registered Windows uninstaller does not currently provide a reliable unattended removal lifecycle. Isolated lifecycle QA confirmed that the exact application registration remained after each bounded removal attempt.',
  'https://github.com/microsoft/winget-pkgs/blob/master/manifests/g/Gstarsoft/DWGFastView/9.10.0/Gstarsoft.DWGFastView.installer.yaml'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Gstarsoft.DWGFastView';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Gstarsoft.DWGFastView'
  and status in ('queued', 'failed');
