-- WeSing Live Assistant 0.0.0.0 is declared as a per-user silent installer,
-- but isolated standard-user QA proved that launching the exact payload with
-- the published /s switch requests elevation and eventually returns Windows
-- ERROR_CANCELLED. No vendor uninstall registration is created. Running this
-- payload as LocalSystem would target the wrong user profile, so keep only
-- this immutable release out of QA and customer deployment. A corrected
-- future release remains independently eligible.

insert into public.qa_package_blocks (
  winget_id,
  version,
  architecture,
  installer_sha256,
  block_code,
  detail
)
values (
  'Tencent.WeSingLiveAssistant',
  '0.0.0.0',
  'x86',
  '0D009D4ACEB24BDC8220357E972B4D17B0B9D5BFA8B1E637EBC87BF8C5FADDCC',
  'user_scope_elevation_required',
  'The vendor declares a per-user /s install, but the exact payload requests elevation under the standard-user Intune contract, returns ERROR_CANCELLED, and creates no authoritative uninstall registration.'
)
on conflict (winget_id, version, architecture, installer_sha256) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    observed_at = now(),
    updated_at = now();
