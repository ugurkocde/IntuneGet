-- Speek 1.7.0's official NSIS source requests user-level execution, writes no
-- Add/Remove Programs registration, and provides an uninstall section that
-- does not recursively remove the installed application directory:
-- https://github.com/Speek-App/Speek/blob/v1.7.0-release/packaging/windows_nsis/installer.nsi
-- The exact WinGet /S command returned zero under LocalSystem in two isolated
-- lifecycle runs, but produced zero new uninstall entries and no stable
-- reviewed machine payload. The first run also retained essentially its full
-- post-install file delta after the generic uninstall attempt. Remove the
-- disproven managed-directory adapter and do not publish a PSADT package whose
-- unattended machine install and removal lifecycle cannot be verified.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Speek.Speek',
  'unsupported_managed_install',
  'Speek 1.7.0 requests user-level execution, creates no standard uninstall registration, and does not expose a reliable unattended machine lifecycle. Two isolated LocalSystem runs produced zero new uninstall entries, and the reviewed adapter could not find a stable installed payload after the exact /S command returned success.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32752063718'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Speek.Speek';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Speek.Speek'
  and status in ('queued', 'failed', 'error');
