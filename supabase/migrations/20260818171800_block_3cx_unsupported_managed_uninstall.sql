-- 3CX Phone System 20 installs silently and registers successfully, but its
-- registered vendor uninstaller does not provide a deterministic unattended
-- lifecycle. Isolated LocalSystem PSADT QA launched the exact registered
-- command and kept checking the exact 3CX registration after its parent
-- process exited. The registration remained through the bounded 310-second
-- completion window and removal verification. Current 3CX guidance requires
-- a backup and an administrator-driven uninstall during upgrades; it does not
-- publish a supported unattended removal contract for this server product.
-- Keep it out of automated Intune packaging rather than guessing destructive
-- service, database, or data-removal behavior on customer systems.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  '3CX.PhoneSystem',
  'unsupported_managed_uninstall',
  '3CX Phone System installs silently, but its registered removal command exits without removing the exact application registration. Current vendor guidance does not publish a deterministic unattended uninstall contract for this server product.',
  'https://www.3cx.com/docs/upgrading-pbx/'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = '3CX.PhoneSystem';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = '3CX.PhoneSystem'
  and status in ('queued', 'failed');
