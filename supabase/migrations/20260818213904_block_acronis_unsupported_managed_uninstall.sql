-- Acronis Cyber Protect Home Office installs and registers successfully, but
-- the exact registered vendor removal command did not remove registration
-- {53A765B1-E86A-4058-A02E-3738B282CEE9}Visible in either the standard bounded
-- lifecycle or a second isolated LocalSystem run with a ten-minute completion
-- window. Acronis' current Windows guide documents an interactive uninstall,
-- including an on-screen storage decision and a possible restart, rather than
-- an unattended enterprise removal contract. Keep this consumer package out
-- of automated Intune packaging until the vendor publishes a supported one.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Acronis.CyberProtectHomeOffice',
  'unsupported_managed_uninstall',
  'Acronis Cyber Protect Home Office installs silently, but its current vendor removal flow does not provide a reliable unattended Intune uninstall lifecycle.',
  'https://dl.acronis.com/u/pdf/ATI2026_userguidewindows_en-US.pdf'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Acronis.CyberProtectHomeOffice';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Acronis.CyberProtectHomeOffice'
  and status in ('queued', 'failed');
