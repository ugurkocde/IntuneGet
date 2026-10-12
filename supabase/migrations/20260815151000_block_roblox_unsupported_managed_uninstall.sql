-- Roblox Player 0.726 installs its current WinGet bootstrapper and creates an
-- Add/Remove Programs registration, but the vendor command returns exit code 7
-- and does not publish a versioned managed-detection contract. Isolated
-- LocalSystem lifecycle QA then invoked the exact registered uninstaller; the
-- application registration and payload remained after the bounded completion
-- deadline. Do not offer this package as a managed Intune application until
-- Roblox publishes a verifiable unattended removal contract.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Roblox.Roblox',
  'unsupported_managed_uninstall',
  'Roblox Player installs silently, but its current bootstrapper does not expose a reliable managed lifecycle. Isolated LocalSystem QA invoked the exact registered uninstaller and confirmed that the application remained installed.',
  'https://github.com/microsoft/winget-pkgs/pull/391567'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Roblox.Roblox';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Roblox.Roblox'
  and status in ('queued', 'failed');
