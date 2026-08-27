-- League of Legends LA1 is delivered as an online Riot bootstrapper rather
-- than a bounded, versioned enterprise installer. In isolated Windows 11
-- user-context lifecycle QA, the vendor's published silent arguments kept the
-- bootstrapper active until the 272-second no-activity guard. The run created
-- thousands of filesystem changes but never produced the managed detection
-- marker or one unambiguous vendor uninstall registration. The remaining
-- child process also resisted bounded cleanup. Do not publish a PSADT package
-- whose installation and removal lifecycle cannot be verified.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'RiotGames.LeagueOfLegends.LA1',
  'unsupported_managed_install',
  'League of Legends LA1 uses an online Riot bootstrapper that did not complete a bounded unattended install. Isolated Windows 11 QA reached the 272-second no-activity guard without producing the managed detection marker or one unambiguous vendor uninstall registration.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/33126223846'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'RiotGames.LeagueOfLegends.LA1';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'RiotGames.LeagueOfLegends.LA1'
  and status in ('queued', 'failed', 'error');
