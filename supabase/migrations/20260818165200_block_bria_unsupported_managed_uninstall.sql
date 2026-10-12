-- Bria 6.8.7.1 installs silently as LocalSystem and registers the expected
-- product code, but the exact MSI uninstall is not a reliable unattended
-- lifecycle. Two isolated PSADT runs closed the Bria background process,
-- invoked that product code, returned MSI exit 1603, and still detected the
-- installed registration after the removal settle window. CounterPath's
-- current support material documents uninstalling through the operating
-- system, but it does not publish a supported unattended removal contract.
-- Do not guess vendor properties on customer devices; keep this version out
-- of automated Intune packaging until a verifiable vendor contract exists.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Bria.Bria',
  'unsupported_managed_uninstall',
  'Bria installs silently, but two isolated PSADT lifecycle tests confirmed that its exact MSI product-code removal returns 1603 and leaves the application registered. The vendor does not publish a supported unattended removal contract.',
  'https://support.counterpath.com/hc/how-to-fully-uninstall-bria'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Bria.Bria';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Bria.Bria'
  and status in ('queued', 'failed');
