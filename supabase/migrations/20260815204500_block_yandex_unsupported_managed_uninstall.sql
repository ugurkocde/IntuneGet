-- The current Yandex Browser WinGet manifest supports unattended installation,
-- but does not publish an unattended uninstall contract. Isolated user-context
-- lifecycle QA confirmed that the registered vendor uninstaller remains
-- interactive: the parent command did not remove YandexBrowser within the
-- bounded five-minute window and independent detection still found the app.
-- Keep the same unsupported lifecycle out of customer packaging and QA until
-- Yandex documents a reliable unattended Windows uninstall command.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'Yandex.Browser',
  'unsupported_managed_uninstall',
  'Yandex Browser supports unattended installation, but its Windows uninstaller currently requires user interaction. Isolated lifecycle QA confirmed that the registered vendor uninstall command did not remove the application or its exact uninstall registration.',
  'https://browser.yandex.com/help/en/about/install'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'Yandex.Browser';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Yandex.Browser'
  and status in ('queued', 'failed');
