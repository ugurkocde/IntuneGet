-- CapCut 9.2 installs silently but registers only its interactive, signed
-- custom uninst.exe. The vendor binary does not publish a QuietUninstallString
-- or a documented unattended removal switch. Isolated QA proved that adding
-- the generic NSIS /S switch leaves the exact CapCut registration and payload
-- installed. Do not offer this as a managed application until ByteDance ships
-- a verifiable unattended removal contract.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'ByteDance.CapCut',
  'unsupported_managed_uninstall',
  'CapCut installs silently but its current signed custom uninstaller exposes no documented unattended removal contract. The generic /S switch was rejected by isolated lifecycle QA because the application remained installed.',
  'https://github.com/microsoft/winget-pkgs/pull/413669'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'ByteDance.CapCut';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'ByteDance.CapCut'
  and status in ('queued', 'failed');
