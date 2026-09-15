-- Exact-payload compatibility quarantine, not a malware or app-wide verdict.
-- Candidate a6585ee0-5180-44dd-9954-91bf3de0c423; run 34919218964.
-- LocalSystem / PSADT 4.1.8 / pin ada1a8a5d1ad0ae9ad953306a6b528c71479a803.
-- Tuple 0/1/60001/1, exact installer/profile SHA matched, VirusTotal 0/0.
-- WinGet expects MTGA Launcher 1.0.124 and product key
-- {BB91E8E1-8030-43C7-8461-1E54166F3AAB}. The VM instead registered
-- MTG Arena 0.1.14123 / Wizards of the Coast / MSI product key
-- {4FEB5AFD-9404-4F46-86D3-27057B012FC7}, alongside Microsoft prerequisites.
-- No configured launcher identity matched. Do not substitute the game MSI
-- or synthesize a launcher marker to manufacture a successful lifecycle.
-- Shared QA demand/customer packaging gates already enforce this exact tuple.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'WizardsoftheCoast.MTGALauncher', '1.0.124', 'x64',
  '96C64E5E0CD4D5758F3C9AE1AF7A2C6FFCF4782E273AEDE28FA92B8E63FFC368',
  'failed_managed_lifecycle',
  'Isolated PSADT run 34919218964 returned 0/1/60001/1 under LocalSystem. Manifest launcher product {BB91E8E1-8030-43C7-8461-1E54166F3AAB} was absent; MTG Arena 0.1.14123 registered as MSI {4FEB5AFD-9404-4F46-86D3-27057B012FC7}. Requires a reviewed exact product/version lifecycle and controlled strict retest before release. VirusTotal was clean (0/0).'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

-- Preserve terminal failures, security findings, and dispatched work.
update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'WizardsoftheCoast.MTGALauncher'
  and version = '1.0.124' and architecture = 'x64'
  and installer_sha256 = '96C64E5E0CD4D5758F3C9AE1AF7A2C6FFCF4782E273AEDE28FA92B8E63FFC368'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
