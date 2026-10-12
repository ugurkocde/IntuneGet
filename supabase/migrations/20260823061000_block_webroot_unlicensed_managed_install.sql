-- Webroot SecureAnywhere's WinGet consumer MSI requires customer-specific
-- provisioning rather than providing a complete generic managed-install
-- contract. The exact MSI exposes GUILIC and CMDLINE properties, but WinGet
-- supplies neither a tenant license nor a documented unattended command. In
-- isolated LocalSystem QA, run 32617479599 reached the 30-minute ceiling with
-- the manifest defaults. Run 32620368724 reached the same 30-minute ceiling
-- after the shared production adapter supplied Webroot's documented business
-- quiet command, CMDLINE=SME,quiet, because GUILIC remained customer-specific.
-- Block the generic catalog package instead of shipping an installer that can
-- stall while remaining unprovisioned. Customer-specific sources remain
-- separate from catalog eligibility and can carry their tenant configuration.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Webroot.SecureAnywhere',
  'unsupported_managed_install',
  'Webroot SecureAnywhere requires customer-specific tenant provisioning through GUILIC. The exact generic WinGet MSI reached the 30-minute LocalSystem installation ceiling both with manifest defaults and with CMDLINE=SME,quiet, so it cannot provide a reliable unattended catalog install.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32620368724'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Webroot.SecureAnywhere';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Webroot.SecureAnywhere'
  and status in ('queued', 'failed', 'error');
