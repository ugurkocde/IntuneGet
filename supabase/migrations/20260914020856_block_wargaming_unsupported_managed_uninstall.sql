-- Wargaming.GameCenter 26.05.00.3403 x86 installed and detected under
-- LocalSystem but its captured setup.exe /IU route, with the Inno quiet
-- arguments, returned vendor exit 1 and retained the exact registration
-- after 310 seconds. PSADT correctly failed closed: 0/0/60001/0.
-- Evidence: https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34797067841
-- Vendor guide: https://wargaming.net/support/en/products/wot/article/35523/
-- The guide requires interactive confirmation. No supported unattended
-- alternative was established; do not guess switches or delete vendor data.
insert into public.package_eligibility_blocks (winget_id, block_code, detail, source_url)
values (
  'Wargaming.GameCenter',
  'unsupported_managed_uninstall',
  'Wargaming Game Center 26.05.00.3403 x86 installed and detected under LocalSystem, but the exact registered setup.exe /IU command with Inno quiet arguments returned vendor exit 1 and retained its registration after the 310-second completion deadline. The vendor guide documents interactive removal. A supported unattended lifecycle is required before automated deployment can be enabled.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34797067841'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Wargaming.GameCenter';

-- Preserve all terminal/security evidence and any already-dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Wargaming.GameCenter'
  and status = 'queued'
  and dispatched_at is null
  and github_run_id is null;
