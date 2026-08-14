-- Some WinGet packages can be installed silently but do not provide a
-- supported automatic full-uninstall contract. IntuneGet must not publish
-- those packages as managed applications because detection and removal could
-- not be made reliable on customer devices.

alter table public.package_eligibility_blocks
  drop constraint if exists package_eligibility_blocks_block_code_check;
alter table public.package_eligibility_blocks
  add constraint package_eligibility_blocks_block_code_check
  check (block_code in (
    'vendor_retired',
    'upstream_removed',
    'unsupported_managed_uninstall'
  ));

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Cygwin.Cygwin',
  'unsupported_managed_uninstall',
  'Cygwin Setup has no automatic full-uninstall facility. The vendor procedure requires manual service, process, filesystem, shortcut, and registry cleanup.',
  'https://cygwin.com/faq/faq.html#faq.setup.uninstall-all'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Cygwin.Cygwin';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Cygwin.Cygwin'
  and status = 'queued';
