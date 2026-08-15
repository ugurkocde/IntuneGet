-- NVIDIA GeForce NOW's consumer bootstrapper does not expose a documented,
-- deterministic enterprise installation contract. The current WinGet silent
-- arguments ran for more than two minutes in isolated user-context lifecycle
-- QA but returned without creating an installed-application registration or a
-- detectable package. The upstream WinGet package issue records the same
-- nondeterministic outcome on physical Windows systems. Do not let this app
-- loop through QA or leave customer uploads waiting for a result that cannot
-- establish a reliable managed lifecycle.

alter table public.package_eligibility_blocks
  drop constraint if exists package_eligibility_blocks_block_code_check;
alter table public.package_eligibility_blocks
  add constraint package_eligibility_blocks_block_code_check
  check (block_code in (
    'vendor_retired',
    'upstream_removed',
    'unsupported_managed_install',
    'unsupported_managed_uninstall'
  ));

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Nvidia.GeForceNow',
  'unsupported_managed_install',
  'NVIDIA GeForce NOW does not currently provide a reliable unattended managed-install contract. Isolated lifecycle QA and the open upstream WinGet package issue both show the bootstrapper can finish without registering an installed application.',
  'https://github.com/microsoft/winget-pkgs/issues/56299'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Nvidia.GeForceNow';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Nvidia.GeForceNow'
  and status in ('queued', 'failed');
