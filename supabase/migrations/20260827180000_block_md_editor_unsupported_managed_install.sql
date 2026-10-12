-- MD Editor 1.1.0 is published to WinGet as a user-scoped MSI, while its
-- Tauri/WiX package declares a per-machine Program Files installation. The
-- package cannot complete directory costing in the LocalSystem context used
-- by Intune. Four isolated strategies failed before product registration:
-- machine scope, public DesktopFolder redirection, REMOVE=ShortcutsFeature
-- (rewritten by the MSI to REMOVE=ALL), and the explicit
-- ADDLOCAL=MainProgram,Environment,External feature allow-list. Do not publish
-- a PSADT package whose unattended managed installation cannot be verified.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'rushabhpasad.MDEditor',
  'unsupported_managed_install',
  'MD Editor 1.1.0 has a contradictory user-scoped WinGet manifest and per-machine Tauri/WiX MSI. Four isolated LocalSystem strategies failed in CostFinalize before product registration, including public desktop redirection and explicit feature selection; the MSI also rewrites REMOVE=ShortcutsFeature to REMOVE=ALL.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/33100285782'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'rushabhpasad.MDEditor';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'rushabhpasad.MDEditor'
  and status in ('queued', 'failed', 'error');
