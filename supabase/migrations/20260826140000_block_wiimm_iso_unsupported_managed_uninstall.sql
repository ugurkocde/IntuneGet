-- Wiimms ISO Tools is distributed as a ZIP containing an argumentless plain
-- EXE installer. The publisher's Windows instructions only say to start that
-- executable, and the official uninstall implementation removes App Paths and
-- PATH entries but does not remove the installed Program Files payload. An
-- Intune package therefore cannot provide a complete, deterministic managed
-- uninstall without inventing unsupported cleanup behavior.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Wiimm.ISO',
  'unsupported_managed_uninstall',
  'Wiimms ISO Tools 3.05a provides an argumentless nested EXE and its official Windows uninstall implementation removes PATH and App Paths entries without removing the installed Program Files payload. A complete unattended managed lifecycle is not available.',
  'https://github.com/Wiimm/wiimms-iso-tools/blob/fc1c0b840cb3ac41ca6e4f1d5e16da12b47eab58/project/setup/windows-uninstall.sh'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Wiimm.ISO';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Wiimm.ISO'
  and status in ('queued', 'failed', 'error');
