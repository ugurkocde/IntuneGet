-- Battle.net installs and registers successfully, but the vendor removal route
-- does not provide a deterministic unattended lifecycle. The isolated
-- LocalSystem test invoked the exact Battle.net ARP command from a safe working
-- directory and waited through the bounded 310-second completion window; the
-- vendor command returned while the exact Battle.net registration remained.
-- Blizzard's support material documents an interactive Programs and Features
-- removal flow, followed by manual folder cleanup when required. It does not
-- publish a supported silent enterprise uninstall contract. Manual deletion is
-- unsafe for managed deployment because the launcher can own customer game
-- locations and shared Battle.net data. Keep the app out of automated Intune
-- packaging until Blizzard provides a verified unattended removal contract.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Blizzard.BattleNet',
  'unsupported_managed_uninstall',
  'Battle.net installs silently, but its current vendor removal flow does not provide a reliable unattended Intune uninstall lifecycle.',
  'https://us.support.blizzard.com/en/article/30304'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Blizzard.BattleNet';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Blizzard.BattleNet'
  and status in ('queued', 'failed');
