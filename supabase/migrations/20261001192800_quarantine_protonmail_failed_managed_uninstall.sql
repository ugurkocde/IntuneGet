-- Exact-payload hold; see docs/qa-protonmail-20261001.md.
-- Preserve failed evidence, unrelated versions, and all security controls.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Proton.ProtonMail', '1.14.0', 'x64',
  '456ADBFE362FDF14EF0A189CDE1962316B46A8E277D139C12A99D39BCAC89BC3',
  'failed_managed_lifecycle',
  'Isolated user-scope PSADT run 36910754201 returned 0/0/60001/0. Exact registered Squirrel Update.exe --uninstall -s exited -1 and registration proton_mail remained after the 310-second completion deadline. Root cause unresolved; release requires reviewed shared remediation and controlled exact-tuple retest. Clean VirusTotal 0/0 is not evidence of lifecycle compatibility. No vendor files or registration were manually removed.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Proton.ProtonMail'
  and version = '1.14.0' and architecture = 'x64'
  and installer_sha256 = '456ADBFE362FDF14EF0A189CDE1962316B46A8E277D139C12A99D39BCAC89BC3'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
