-- Wise Disk Cleaner 11.2.7 installs and detects successfully under LocalSystem,
-- but its exact registered Inno Setup uninstaller does not provide a complete
-- unattended removal lifecycle. Isolated QA run 32569486048 invoked
-- unins000.exe with the captured silent arguments and waited five minutes for
-- the authoritative Wise Disk Cleaner_is1 registration to disappear. The ARP
-- entry and both shortcuts remained, while the residual snapshot contained
-- roughly 2,967 added files. Block publication instead of treating the cleared
-- IntuneGet detection marker as proof that the vendor application was removed.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'WiseCleaner.WiseDiskCleaner',
  'unsupported_managed_uninstall',
  'Wise Disk Cleaner installs unattended, but its exact registered silent uninstaller did not remove the application within five minutes. Isolated QA retained the ARP entry, both shortcuts, and roughly 2,967 added files, so automated managed removal cannot be verified.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32569486048'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'WiseCleaner.WiseDiskCleaner';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'WiseCleaner.WiseDiskCleaner'
  and status in ('queued', 'failed', 'error');
