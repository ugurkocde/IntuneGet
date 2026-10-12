-- Tencent QQ NT 9.9.33 installs and detects successfully under LocalSystem,
-- but its exact machine-wide Uninstall.exe does not provide a complete
-- unattended removal lifecycle. Isolated QA runs 32579988209 and 32582110657
-- invoked the captured command first without arguments and then with /S. Both
-- processes exited immediately while the exact QQ registration, application
-- payload, and shortcuts remained. The second run retained both shortcuts and
-- roughly 4,826 added files after the full five-minute completion window.
-- Block publication rather than treating the cleared IntuneGet detection
-- marker as proof that the vendor application was removed.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Tencent.QQ.NT',
  'unsupported_managed_uninstall',
  'Tencent QQ NT installs unattended, but its exact registered uninstaller did not remove the application either without arguments or with /S. Isolated QA retained the exact QQ registration, both shortcuts, and roughly 4,826 added files, so automated managed removal cannot be verified.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32582110657'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Tencent.QQ.NT';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Tencent.QQ.NT'
  and status in ('queued', 'failed', 'error');
