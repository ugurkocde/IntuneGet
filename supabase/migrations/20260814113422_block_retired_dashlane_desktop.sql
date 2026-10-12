-- Dashlane retired its standalone Windows desktop application and now
-- supports desktop access through browser extensions. Keep the obsolete 2022
-- WinGet installer out of both customer packaging and automated QA.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Dashlane.Dashlane',
  'vendor_retired',
  'Dashlane retired its standalone Windows desktop application. Current Windows access is delivered through supported browser extensions.',
  'https://support.dashlane.com/hc/en-us/articles/202625002-Supported-devices-and-browsers'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Dashlane.Dashlane';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Dashlane.Dashlane'
  and status = 'queued';
