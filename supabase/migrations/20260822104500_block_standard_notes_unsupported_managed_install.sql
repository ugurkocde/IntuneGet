-- Standard Notes is a per-user NSIS application even when its catalog package
-- is executed by LocalSystem. Isolated QA run 32562682034 installed it beneath
-- the LocalSystem profile and captured the exact vendor uninstall registration.
-- Before the managed uninstall phase, that registration's executable had
-- disappeared while the application registration and roughly 2,890 added
-- files remained. Clearing the IntuneGet marker is not evidence that the
-- vendor application was removed, so do not publish this lifecycle.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'StandardNotes.StandardNotes',
  'unsupported_managed_install',
  'Standard Notes installs into the LocalSystem profile during device-context deployment, and its exact registered NSIS uninstaller disappeared before managed removal. Isolated QA retained the application registration and roughly 2,890 installed files, so a safe customer lifecycle cannot be verified.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32562682034'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'StandardNotes.StandardNotes';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'StandardNotes.StandardNotes'
  and status in ('queued', 'failed', 'error');
