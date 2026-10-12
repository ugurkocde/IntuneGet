-- darktable 5.6.0 uses the WinGet-published NSIS /S command, but its signed
-- installer did not complete or create an authoritative Apps & Features
-- identity in two isolated LocalSystem PSADT retries. The final run used the
-- stable 8 GB VM policy and emitted continuous process heartbeats for the full
-- reviewed 15-minute ceiling. Keep this lifecycle out of automated customer
-- deployment rather than extending the queue indefinitely or claiming an
-- installation that cannot be detected and removed deterministically.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'darktable.darktable',
  'unsupported_managed_install',
  'darktable 5.6.0 remains active beyond the reviewed 15-minute LocalSystem installation ceiling without creating an authoritative application registration for detection and managed removal.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32246509168'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'darktable.darktable';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'darktable.darktable'
  and status in ('queued', 'failed');
