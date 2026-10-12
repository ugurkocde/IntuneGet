-- Filmora 15.7.25.21914 x64 failed its manifest-derived Inno silent install
-- with exit 2 and no installed registration; uninstall failed closed (60001).
-- https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34732772214
-- Wondershare explicitly states that Filmora does not support silent installation:
-- https://support.wondershare.com/how-tos/filmora/does-filmora-support-silent-installation.html
-- Use the existing shared QA/customer eligibility gate. Retain terminal evidence.
insert into public.package_eligibility_blocks (winget_id, block_code, detail, source_url)
values (
  'Wondershare.Filmora',
  'unsupported_managed_install',
  'Wondershare states that Filmora does not support silent installation. Version 15.7.25.21914 x64 returned install exit 2 with the manifest-derived silent arguments and created no installed registration. A vendor-supported unattended lifecycle is required before automated deployment can be enabled.',
  'https://support.wondershare.com/how-tos/filmora/does-filmora-support-silent-installation.html'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Wondershare.Filmora';

update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Wondershare.Filmora'
  and status = 'queued'
  and dispatched_at is null
  and github_run_id is null;
