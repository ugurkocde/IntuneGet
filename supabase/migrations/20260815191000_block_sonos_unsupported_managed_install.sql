-- Sonos distributes the desktop controller as an InstallShield launcher whose
-- embedded MSI is not available as a stable first-party download. The native
-- EXE does not provide a reliable unattended LocalSystem installation path:
-- the published silent arguments and InstallShield administrative-image mode
-- both return MSI 1619, while the commonly documented MSI extraction command
-- either enters uninstall mode or requires an interactive packaging session.
-- Keep the application out of both customer packaging and QA until Sonos
-- publishes a supported enterprise installer or the MSI can be prepared in an
-- isolated, non-customer execution stage.

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
  'Sonos.Controller',
  'unsupported_managed_install',
  'The Sonos controller EXE does not currently provide a reliable unattended LocalSystem installation contract. The vendor launcher rejected both the published silent MSI path and a bounded InstallShield administrative-image path during isolated lifecycle QA.',
  'https://ideas.patchmypc.com/ideas/PATCHMYPC-I-1498'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Sonos.Controller';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Sonos.Controller'
  and status in ('queued', 'failed');
