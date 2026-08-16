-- Core Temp 1.20.1 installs silently and is detected correctly, but its
-- registered Inno uninstaller does not complete an unattended LocalSystem
-- removal. Isolated lifecycle QA first tested the complete quiet Inno switch
-- set, then repeated the lifecycle after closing the vendor-documented desktop
-- process. Both profiles left the exact ARP entry installed after the bounded
-- 310-second deadline. ALCPU only documents interactive removal through
-- Programs and Features, while its hardware driver can remain loaded until it
-- is explicitly stopped or Windows restarts. Do not offer this as a managed
-- application until the vendor publishes a verifiable unattended lifecycle.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'ALCPU.CoreTemp',
  'unsupported_managed_uninstall',
  'Core Temp installs silently, but its current Inno uninstaller does not remove the application during an unattended LocalSystem lifecycle, including after the desktop process is closed. The vendor documents only interactive removal and the application remains detected after the bounded completion deadline.',
  'https://www.alcpu.com/forums/viewtopic.php?p=8987'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'ALCPU.CoreTemp';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'ALCPU.CoreTemp'
  and status in ('queued', 'failed');
