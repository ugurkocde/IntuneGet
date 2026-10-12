-- Ximalaya Live 4.67.987 declares a user-scoped Nullsoft installer but does
-- not publish an explicit unattended install contract. In the isolated
-- standard-user PSADT lifecycle, the exact signed WinGet payload exited 1 in
-- under two seconds with the default Nullsoft /S argument, added no uninstall
-- registration, and remained undetected. The deployment host emitted only
-- "Press any key to exit..." for both attempted lifecycle commands. Do not
-- offer customers a package that cannot install silently and deterministically.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Ximalaya.XimalayaLive',
  'unsupported_managed_install',
  'Ximalaya Live 4.67.987 exited 1 in under two seconds during the isolated standard-user PSADT install with the default Nullsoft /S argument. It added no uninstall registration, failed detection, and exposed no verified unattended install contract.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32956188340'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Ximalaya.XimalayaLive';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Ximalaya.XimalayaLive'
  and status in ('queued', 'failed', 'error');
