-- Teradata Tools and Utilities Base is a multi-product suite rather than a
-- single independently removable application. Exact isolated QA run
-- 32568333477 installed Teradata.TeradataBaseSuite successfully and captured
-- the suite registration {F1847ED2-DBF5-45D1-98C9-0F634A3D2000}. Its exact
-- registered suitesetup.exe -remove -runfromtemp command returned without
-- removing that registration during the five-minute completion window. The
-- authoritative residual snapshot retained all 28 added uninstall entries,
-- roughly 6,033 added files, and all 18 added shortcuts.
--
-- Teradata.TTUBase is the newer alias for the same TTU Base suite: its queued
-- catalog profile uses the same suite bootstrapper, selection arguments,
-- product registration, and registry-driven uninstall lifecycle. Block both
-- package IDs so the duplicate alias cannot publish the already disproven
-- managed-removal path.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values
  (
    'Teradata.TeradataBaseSuite',
    'unsupported_managed_uninstall',
    'Teradata Tools and Utilities Base installs as a 28-product suite, but its exact registered suite removal command did not remove the suite registration within five minutes. Isolated QA retained all 28 added uninstall entries, roughly 6,033 files, and all 18 shortcuts, so complete automated managed removal cannot be verified.',
    'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32568333477'
  ),
  (
    'Teradata.TTUBase',
    'unsupported_managed_uninstall',
    'Teradata.TTUBase is the newer catalog alias for the same multi-product TTU Base suite and uses the same suite bootstrapper, selection arguments, product registration, and registry-driven removal path disproven by isolated QA. Complete automated managed removal cannot be verified.',
    'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32568333477'
  )
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id in ('Teradata.TeradataBaseSuite', 'Teradata.TTUBase');

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id in ('Teradata.TeradataBaseSuite', 'Teradata.TTUBase')
  and status in ('queued', 'failed', 'error');
