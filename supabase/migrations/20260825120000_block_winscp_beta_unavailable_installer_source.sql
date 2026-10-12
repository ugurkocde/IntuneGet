-- WinSCP.WinSCP.Beta 6.6.1.beta is hosted only on SourceForge, which refuses
-- automated retrieval from the packaging infrastructure. Twelve consecutive
-- package-app runs between 2026-08-06 and 2026-08-21 failed at the download
-- stage: the primary sourceforge.net URL and every one of the seven configured
-- dl.sourceforge.net mirrors returned HTTP 403.
-- https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32475327124
--
-- The file has not been withdrawn upstream. It still returns HTTP 200 from
-- ordinary networks, so this is a source-access restriction against the CI
-- egress range rather than an upstream removal, and it cannot be repaired by
-- retrying, by mirror rotation, or by any change to the packaging workflow.
-- A package whose installer cannot be fetched can never produce a verified
-- deployment, so remove it from the catalog and refuse it everywhere,
-- including community requests.
--
-- This is a beta channel package. The reviewed stable id WinSCP.WinSCP is a
-- different package and is not covered by this block.

alter table public.package_eligibility_blocks
  drop constraint if exists package_eligibility_blocks_block_code_check;
alter table public.package_eligibility_blocks
  add constraint package_eligibility_blocks_block_code_check
  check (block_code in (
    'vendor_retired',
    'upstream_removed',
    'unsupported_managed_install',
    'unsupported_managed_uninstall',
    'unsupported_installer_source'
  ));

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'WinSCP.WinSCP.Beta',
  'unsupported_installer_source',
  'WinSCP Beta 6.6.1.beta is distributed only through SourceForge, which returns HTTP 403 to the packaging infrastructure on both the primary download URL and all seven configured mirrors. Twelve consecutive runs between 2026-08-06 and 2026-08-21 failed at the download stage. The file is still published and reachable from other networks, so this is a source-access restriction rather than an upstream removal, and no retry or mirror rotation can recover it. The installer can never be fetched, so no verified package can be produced.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32475327124'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'WinSCP.WinSCP.Beta';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'WinSCP.WinSCP.Beta'
  and status in ('queued', 'failed', 'error');

-- Close any community request for a package that can never be delivered, and
-- keep it closed. New requests are refused by the eligibility gate in
-- app/api/community/suggestions.
update public.app_suggestions
set status = 'rejected'
where winget_id ilike 'WinSCP.WinSCP.Beta'
  and status in ('pending', 'approved');
