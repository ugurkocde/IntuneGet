-- OpenSCAD 2021.01's NSIS uninstaller removes the application files but leaves
-- its Apps & Features registration behind. The vendor tracks this exact defect:
-- https://github.com/openscad/openscad/issues/5494
-- Isolated LocalSystem QA invoked the captured vendor Uninstall.exe with the
-- documented /S switch and waited the full five-minute completion window; the
-- OpenSCAD registration remained and removal detection correctly stayed true.
-- Do not publish a managed package that leaves an orphaned installed-app entry.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'OpenSCAD.OpenSCAD',
  'unsupported_managed_uninstall',
  'OpenSCAD 2021.01 removes its application files but leaves the Windows uninstall registration behind. Exact isolated QA invoked the documented NSIS /S uninstaller and confirmed the registration still remained after the full completion window.',
  'https://github.com/openscad/openscad/issues/5494'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'OpenSCAD.OpenSCAD';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'OpenSCAD.OpenSCAD'
  and status in ('queued', 'failed', 'error');
