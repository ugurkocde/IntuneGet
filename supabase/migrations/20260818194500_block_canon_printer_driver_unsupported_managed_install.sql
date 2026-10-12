-- Canon's PCL6 V4 Driver 21.00 package is an opaque EXE whose WinGet
-- manifest declares no Silent or SilentWithProgress switches. An isolated
-- LocalSystem PSADT lifecycle run using the former generic /S fallback did
-- not create an authoritative application registration, so deterministic
-- install verification and removal are unavailable. Keep this driver out of
-- automated deployment until Canon or WinGet publishes a reviewed unattended
-- contract instead of guessing a vendor command on customer devices.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Canon.GPCL6_V4_PrinterDriver_V21.00',
  'unsupported_managed_install',
  'Canon PCL6 V4 Driver 21.00 is published as a plain EXE without silent switches. Isolated LocalSystem QA confirmed that the generic /S fallback does not produce a deterministic managed application identity for verification and removal.',
  'https://github.com/microsoft/winget-pkgs/commit/d7f86d1703d858d6f7fe0308016a2134f05cc03e'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Canon.GPCL6_V4_PrinterDriver_V21.00';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Canon.GPCL6_V4_PrinterDriver_V21.00'
  and status in ('queued', 'failed');
