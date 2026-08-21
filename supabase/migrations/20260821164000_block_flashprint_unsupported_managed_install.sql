-- FlashPrint 5.8.3 uses the WinGet-published Advanced Installer command from
-- its nested signed EXE, but it never completed or created an authoritative
-- Apps & Features identity under LocalSystem. The final isolated retry used
-- the reviewed nested-process contract, emitted continuous PSADT heartbeats,
-- and remained active for the full 15-minute ceiling. Keep this lifecycle out
-- of automated customer deployment instead of extending the bounded wait or
-- claiming detection and managed removal without vendor registration.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Flashforge.FlashPrint',
  'unsupported_managed_install',
  'FlashPrint 5.8.3 remains active beyond the reviewed 15-minute LocalSystem installation ceiling without creating an authoritative application registration for detection and managed removal.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32501894421'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Flashforge.FlashPrint';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Flashforge.FlashPrint'
  and status in ('queued', 'failed');
