-- AMD Software: Cloud Edition 23.Q3 is a hardware-specific Azure GPU driver,
-- not a general-purpose Windows application. Microsoft documents this package
-- for Azure NGads V620-series VMs and verifies it through the matching Radeon
-- Pro V620 device. Isolated LocalSystem QA run 32484265649 used the exact
-- manifest command, but the generic QA VM has no supported AMD GPU: the setup
-- changed only two installer/component registrations, created no matching
-- Cloud Edition application identity, and left no deterministic managed
-- install/uninstall lifecycle. Automated packaging cannot supply or attest the
-- required VM hardware, so block this package instead of publishing a false
-- portable lifecycle for unrelated customer devices.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'AMD.AMDSoftwareCloudEdition',
  'unsupported_managed_install',
  'AMD Software: Cloud Edition is a hardware-dependent Azure GPU driver for supported N-series AMD GPU VMs. Isolated LocalSystem QA on a generic VM cannot supply or attest the required AMD GPU and produced no deterministic Cloud Edition application identity.',
  'https://learn.microsoft.com/en-us/azure/virtual-machines/windows/n-series-amd-driver-setup'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'AMD.AMDSoftwareCloudEdition';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'AMD.AMDSoftwareCloudEdition'
  and status in ('queued', 'failed');
