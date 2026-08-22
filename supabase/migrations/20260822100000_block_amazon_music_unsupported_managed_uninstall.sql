-- Amazon Music 9.4.0.2386 installs successfully with the argument-free
-- bootstrapper validated by Microsoft's WinGet pipeline, but its registered
-- per-user Uninstall.exe does not provide a complete unattended removal
-- lifecycle. Exact isolated QA run 32559549247 invoked that captured command
-- and waited fifteen minutes for the authoritative ARP key to disappear. The
-- key remained, and the residual snapshot still contained one added uninstall
-- entry plus roughly 2,500 added files. The IntuneGet detection marker cleared,
-- but that is not evidence that the vendor application was removed. Block the
-- app instead of publishing a package that leaves Amazon Music installed.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Amazon.Music',
  'unsupported_managed_uninstall',
  'Amazon Music installs unattended, but its exact registered per-user uninstaller did not remove the application after a bounded fifteen-minute wait. Isolated QA retained the ARP entry and installed files, so automated managed removal cannot be verified.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32559549247'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Amazon.Music';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Amazon.Music'
  and status in ('queued', 'failed', 'error');
