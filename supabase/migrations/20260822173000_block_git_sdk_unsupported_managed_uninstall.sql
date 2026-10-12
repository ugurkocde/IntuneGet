-- Git for Windows SDK 1.0.8 is an extraction bootstrapper, not a managed
-- Windows installer. Its pinned vendor source concatenates a 7-Zip SFX stub,
-- sets C:\git-sdk-64 as the default extraction path, runs setup-git-sdk.bat,
-- and explicitly describes the result as a self-extracting .7z archive. It
-- does not create a product uninstaller or authoritative ARP registration.
-- Isolated LocalSystem QA run 32584238843 confirmed that installation changed
-- two pre-existing uninstall entries but produced zero matching uninstall
-- entries for the SDK. Removal therefore had no vendor command to execute and
-- the residual snapshot retained roughly 2,944 added files. Do not publish an
-- Intune lifecycle whose only possible removal would be broad directory
-- deletion without a vendor-managed uninstall contract.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Git.SDK',
  'unsupported_managed_uninstall',
  'Git for Windows SDK is delivered as a self-extracting .7z archive that creates no product uninstaller or authoritative ARP registration. Isolated QA found zero matching uninstall entries and retained roughly 2,944 added files, so automated managed removal cannot be verified.',
  'https://github.com/git-for-windows/build-extra/blob/git-sdk-1.0.8/sdk-installer/release.sh'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Git.SDK';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Git.SDK'
  and status in ('queued', 'failed', 'error');
