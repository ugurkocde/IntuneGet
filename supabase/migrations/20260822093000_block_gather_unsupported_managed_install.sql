-- Gather 1.39.2 publishes a scope-less NSIS package. Under Intune LocalSystem,
-- isolated QA installed it beneath the executing SYSTEM profile and captured
-- its exact ARP command at:
-- C:\Windows\system32\config\systemprofile\AppData\Local\Programs\Gather.
-- Before managed removal began, the registered Uninstall Gather.exe had
-- disappeared. The package therefore cannot provide a stable machine-wide
-- install and uninstall lifecycle for employee devices. Block it instead of
-- shipping a package tied to LocalSystem's private profile or guessing at
-- vendor switches not declared by the official WinGet manifest.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Gather.Gather',
  'unsupported_managed_install',
  'Gather uses a per-user NSIS lifecycle. Under Intune LocalSystem it installs beneath the SYSTEM profile, and isolated QA confirmed that its exact registered uninstaller disappeared before managed removal could begin.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32558961384'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Gather.Gather';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Gather.Gather'
  and status in ('queued', 'failed', 'error');
