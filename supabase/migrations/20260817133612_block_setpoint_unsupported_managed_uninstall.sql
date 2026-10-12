-- Logitech SetPoint installs and registers successfully, but the registered
-- sp6 removal route does not provide a deterministic unattended lifecycle.
-- Two isolated LocalSystem tests closed SetPoint, SetPointII, and KHALMNPR;
-- the corrected retry also executed from a safe working directory outside the
-- application tree. In both runs the vendor parent exited while the exact sp6
-- registration remained through the bounded 310-second completion window.
-- Logitech's SetPoint support material documents an interactive Programs and
-- Features removal flow, not a supported silent enterprise uninstall command.
-- Keep this legacy package out of automated Intune packaging until a verified
-- unattended vendor contract becomes available.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Logitech.SetPoint',
  'unsupported_managed_uninstall',
  'Logitech SetPoint installs silently, but its current vendor removal flow does not provide a reliable unattended Intune uninstall lifecycle.',
  'https://support.logi.com/hc/en-us/articles/360023237354-Unable-to-customize-my-mouse-or-keyboard-in-SetPoint'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Logitech.SetPoint';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Logitech.SetPoint'
  and status in ('queued', 'failed');
