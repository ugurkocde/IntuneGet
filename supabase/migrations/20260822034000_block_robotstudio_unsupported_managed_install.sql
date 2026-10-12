-- ABB RobotStudio 2025.2 ships an InstallShield wrapper around an MSI whose
-- Setup.ini confirms product code {F8E387C8-8D36-4513-A1AB-9C438461D926}.
-- ABB's documented full unattended command completes under LocalSystem, but
-- isolated lifecycle QA never establishes that RobotStudio registration. The
-- wrapper instead leaves several prerequisite/background registrations, which
-- are not safe to claim or remove as the application. The shared packager's
-- exact-identity guard therefore fails closed instead of selecting an unrelated
-- product such as Microsoft Edge.
-- Exact repaired lifecycle evidence:
-- https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32549111966
-- ABB unattended-install contract:
-- https://tech-community.robotics.abb.com/discussion/10329/robotstudio-silent-install

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'ABB.RobotStudio',
  'unsupported_managed_install',
  'RobotStudio 2025.2 does not establish its exact ABB MSI registration during the vendor-documented full silent LocalSystem install. The wrapper leaves only prerequisite/background registrations, which cannot safely serve as application detection or managed-removal identities.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/32549111966'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'ABB.RobotStudio';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'ABB.RobotStudio'
  and status in ('queued', 'failed', 'error');
