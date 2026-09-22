-- Exact compatibility quarantine; evidence: docs/qa-wardian-20260922.md.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'WardianApp.Wardian', '0.6.1', 'x64',
  '5804571F3796E39ED8AC5FFC23F068E17199477531BD1007C9CDF71A8FE64AF6',
  'failed_managed_lifecycle',
  'Isolated LocalSystem PSADT run 35705553699 returned 0/0/60001/0. Captured registration Wardian points to a missing uninstall.exe under the SYSTEM profile. VirusTotal was not_found, not a clean 0/0 verdict. Release requires a reviewed managed-removal contract and controlled strict exact-tuple retest including clean security evidence.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve failed evidence, active work, and unrelated security quarantines.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'WardianApp.Wardian'
  and version = '0.6.1' and architecture = 'x64'
  and installer_sha256 = '5804571F3796E39ED8AC5FFC23F068E17199477531BD1007C9CDF71A8FE64AF6'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
