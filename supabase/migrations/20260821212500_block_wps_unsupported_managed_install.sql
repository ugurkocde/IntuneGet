-- WPS Office 12.2.0.23196 cannot complete an unattended managed install in
-- either supported execution context. Its exact user-scoped -S invocation
-- requests elevation and is cancelled without creating an application
-- identity. The reviewed LocalSystem retry launches the same trusted vendor
-- installer, but stalls without activity and creates neither the synthetic
-- detection marker nor an unambiguous Apps & Features uninstall entry. Keep
-- this lifecycle out of automated customer deployment.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Kingsoft.WPSOffice',
  'unsupported_managed_install',
  'WPS Office 12.2.0.23196 cannot complete an unattended managed install: user scope requests elevation and is cancelled, while the reviewed LocalSystem -S retry stalls without activity and creates no authoritative detection or uninstall identity.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32527160668'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Kingsoft.WPSOffice';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Kingsoft.WPSOffice'
  and status in ('queued', 'failed', 'error');
