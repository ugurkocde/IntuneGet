-- Wisenet WAVE Client 6.0.5.41290 installs silently and is detected correctly,
-- but its signed Burn uninstaller does not complete unattended LocalSystem
-- removal. Isolated lifecycle QA tested the exact registered uninstaller and
-- repeated the lifecycle after closing the vendor-documented `Wisenet WAVE`
-- desktop process. Both profiles returned 1603, left the exact ARP entry in
-- place after the bounded 311-second deadline, and remained independently
-- detected. Hanwha documents Windows removal through its installer or the
-- interactive Programs and Features flow, not a silent enterprise command.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Hanwha.WisenetWAVEClient',
  'unsupported_managed_uninstall',
  'Wisenet WAVE Client installs silently, but its current signed Burn uninstaller returns 1603 and leaves the application installed during unattended LocalSystem removal, including after the documented desktop process is closed. The vendor documents only interactive Windows removal.',
  'https://support.hanwhavision.com/hc/en-us/articles/47257343139347-How-do-I-cleanly-uninstall-WAVE'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Hanwha.WisenetWAVEClient';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Hanwha.WisenetWAVEClient'
  and status in ('queued', 'failed');
