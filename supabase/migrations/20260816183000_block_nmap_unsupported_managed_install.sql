-- The only published Insecure.Nmap WinGet manifest is the obsolete 7.80
-- user-scope installer. Isolated lifecycle QA confirmed that its advertised
-- silent switch does not complete a managed install or create an unambiguous
-- installed-app registration. The open WinGet update for the maintained Nmap
-- release is explicitly blocked as Interactive-Only-Installer. Do not offer
-- this package for customer deployment or repeatedly consume the QA VM until
-- a verifiable unattended installer contract becomes available.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Insecure.Nmap',
  'unsupported_managed_install',
  'The published Nmap package does not provide a verifiable unattended managed-install contract. QA of WinGet version 7.80 returned 60001 and created no unambiguous installed-app registration; the maintained-version WinGet request is classified as interactive-only.',
  'https://github.com/microsoft/winget-pkgs/issues/341747'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Insecure.Nmap';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Insecure.Nmap'
  and status in ('queued', 'failed');
