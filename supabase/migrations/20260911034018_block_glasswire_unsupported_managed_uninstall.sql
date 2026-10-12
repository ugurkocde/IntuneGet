-- GlassWire 3.10.1138 x64 installed/detected under LocalSystem, but its exact
-- registered C:\Program Files\GlassWire\uninstall.exe /S left registration
-- [GlassWire 3.10] after the 310-second deadline (0/0/60001/0).
-- Evidence: https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34558003501
-- Vendor removal guide: https://www.glasswire.com/userguide/#Uninstall
-- The current guide documents interactive removal; no reviewed alternative
-- unattended removal contract is available. Block shared customer/QA demand
-- until a supported lifecycle is established. Preserve the failed audit record.
insert into public.package_eligibility_blocks (winget_id, block_code, detail, source_url)
values (
  'GlassWire.GlassWire',
  'unsupported_managed_uninstall',
  'GlassWire 3.10.1138 x64 installed and detected under LocalSystem, but the exact registered uninstaller with /S left GlassWire 3.10 registered after the 310-second completion deadline. Managed removal remains unverified; a supported unattended lifecycle is required before automated deployment can be enabled.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34558003501'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'GlassWire.GlassWire';

-- Only undispatched demand is superseded; terminal/security evidence is retained.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'GlassWire.GlassWire'
  and status = 'queued'
  and dispatched_at is null
  and github_run_id is null;
