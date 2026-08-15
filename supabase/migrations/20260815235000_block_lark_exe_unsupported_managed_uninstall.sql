-- Lark's user-scoped EXE manifest supports unattended installation, but does
-- not publish an unattended uninstall contract. Isolated lifecycle QA confirmed
-- that the registered vendor uninstaller stayed interactive for more than five
-- minutes and independent detection still found the application. Lark publishes
-- a separate enterprise MSI package, so keep the EXE package out of customer
-- packaging and QA rather than guessing an undocumented removal switch.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'ByteDance.Lark',
  'unsupported_managed_uninstall',
  'The user-scoped Lark EXE supports unattended installation but not a reliable unattended uninstall. Use the separate ByteDance.Lark.MSI enterprise package for managed deployment.',
  'https://www.larksuite.com/hc/en-US/articles/360048487868-deploy-lark-by-using-microsoft-installer'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'ByteDance.Lark';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment. Use ByteDance.Lark.MSI instead.',
    updated_at = now()
where winget_id = 'ByteDance.Lark'
  and status in ('queued', 'failed');
