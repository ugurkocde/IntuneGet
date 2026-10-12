-- ReceitanetBX 1.10.0 installs silently and registers its exact application
-- identity, but its captured vendor uninstaller is not a reliable unattended
-- lifecycle. Two isolated PSADT runs waited more than five minutes: the first
-- used the registered command and the second appended WinGet's published
-- `/mode silent` argument. Both returned 60001 and left the app registered.
-- Do not guess additional switches on customer devices; keep the package out
-- of managed Intune packaging until the vendor publishes a verifiable removal
-- contract.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'ReceitaFederaldoBrasil.ReceitanetBX',
  'unsupported_managed_uninstall',
  'ReceitanetBX installs silently, but two isolated PSADT lifecycle tests confirmed that its registered vendor uninstaller remains interactive even with the published /mode silent argument and leaves the application registered.',
  'https://github.com/microsoft/winget-pkgs/blob/master/manifests/r/ReceitaFederaldoBrasil/ReceitanetBX/1.10.0/ReceitaFederaldoBrasil.ReceitanetBX.installer.yaml'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'ReceitaFederaldoBrasil.ReceitanetBX';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'ReceitaFederaldoBrasil.ReceitanetBX'
  and status in ('queued', 'failed');
