-- TreeSize installs and registers under LocalSystem, but its exact Inno
-- uninstaller does not remove the registered product within the bounded QA
-- window. This was reproduced in both the default current-user mode and the
-- reviewed /ALLUSERS administrative mode. Do not claim a managed lifecycle.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'JAMSoftware.TreeSize',
  'unsupported_managed_uninstall',
  'TreeSize installs and detects under LocalSystem, but its exact Inno uninstaller leaves the registered product installed after both the default current-user mode and the reviewed /ALLUSERS administrative mode.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32519690272'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'JAMSoftware.TreeSize';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'JAMSoftware.TreeSize'
  and status in ('queued', 'failed', 'error');
