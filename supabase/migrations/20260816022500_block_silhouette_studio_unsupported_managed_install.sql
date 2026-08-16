-- Silhouette Studio 5.0.414 does not expose a supported unattended install
-- contract. The vendor explicitly states that Silhouette software products do
-- not support silent installation and that no MSI alternative is available.
-- Isolated lifecycle QA confirmed the current WinGet bootstrapper returns 1619
-- with its published quiet arguments and creates no installed-app registration.
-- Do not offer the package for managed customer deployment or keep retrying it
-- in QA until the vendor publishes a verifiable silent installation method.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Silhouette.SilhouetteStudio',
  'unsupported_managed_install',
  'Silhouette Studio does not support silent installation and the vendor does not provide an MSI alternative. The current WinGet bootstrapper returns 1619 during unattended LocalSystem installation and creates no installed-application registration.',
  'https://silhouetteamerica.freshdesk.com/support/solutions/articles/35000273905-software-overview'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Silhouette.SilhouetteStudio';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Silhouette.SilhouetteStudio'
  and status in ('queued', 'failed');
