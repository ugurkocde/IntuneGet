-- PotPlayer 26.07.01.0 does not provide a deterministic unattended
-- LocalSystem installation lifecycle. Two isolated PSADT runs used the exact
-- current x64 payload and hash. The WinGet/NSIS /S command and the reviewed
-- /S /allusers variant both launched successfully, then stopped producing
-- installer activity without completing or registering an Apps & Features
-- entry. A Microsoft deployment report independently describes PotPlayer
-- succeeding under an interactive administrator while failing in the SYSTEM
-- context used by managed deployment. Keep this package out of automated
-- Intune packaging rather than publishing an unverified user-context workaround.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Daum.PotPlayer',
  'unsupported_managed_install',
  'PotPlayer 26.07.01.0 starts under LocalSystem but does not complete or register an application identity with either the WinGet silent command or the reviewed all-users variant. No deterministic unattended SYSTEM installation contract is available.',
  'https://learn.microsoft.com/en-us/answers/questions/991238/sccm-deployed-apps-failed-with-errors'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Daum.PotPlayer';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Daum.PotPlayer'
  and status in ('queued', 'failed');
