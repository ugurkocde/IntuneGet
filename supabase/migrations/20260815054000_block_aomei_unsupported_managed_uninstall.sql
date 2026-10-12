-- AOMEI Partition Assistant 10.12.0 installs silently, but the vendor only
-- documents interactive removal and a manual recovery procedure that deletes
-- its installation directory and uninstall registration, sometimes followed
-- by a reboot. Isolated LocalSystem lifecycle QA tested the registered Inno
-- command with /S, /SILENT, and the complete unattended Inno switch set; each
-- attempt left the exact application registration installed after the bounded
-- completion deadline. Do not offer this as a managed application until AOMEI
-- publishes a verifiable unattended removal contract.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'AOMEI.PartitionAssistant',
  'unsupported_managed_uninstall',
  'AOMEI Partition Assistant installs silently, but its current uninstaller has no vendor-documented unattended removal contract. Multiple exact quiet-command variants were rejected by isolated lifecycle QA because the application remained installed.',
  'https://www.diskpart.com/help/install-and-uninstall.html'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'AOMEI.PartitionAssistant';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'AOMEI.PartitionAssistant'
  and status in ('queued', 'failed');
