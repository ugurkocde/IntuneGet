-- Google retired Desktop, including support, on September 14, 2011.
-- Run 36833796643 stalled during install and retained its exact ARP entry
-- after managed uninstall. Use the shared customer/QA retirement gate.
insert into public.package_eligibility_blocks
  (winget_id, block_code, detail, source_url)
values (
  'Google.GoogleDesktop',
  'vendor_retired',
  'Google discontinued Google Desktop and its associated APIs, services, plugins, gadgets, and support on September 14, 2011. Automated deployment is unavailable.',
  'https://googleblog.blogspot.com/2011/09/fall-spring-clean.html'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Google.GoogleDesktop';

-- Preserve failed lifecycle evidence and never touch an active lifecycle.
update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'QA superseded because Google Desktop was retired by its publisher.',
    updated_at = now()
where winget_id = 'Google.GoogleDesktop'
  and status = 'queued';
