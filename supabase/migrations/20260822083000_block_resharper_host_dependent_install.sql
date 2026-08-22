-- ReSharper is a Visual Studio extension rather than a standalone application.
-- JetBrains documents that installation targets selected supported Visual Studio
-- versions. Isolated LocalSystem QA run 32556611318 invoked the catalog's exact
-- machine-wide silent command and the vendor bootstrapper returned 0, but the
-- clean VM had no qualifying IDE host and produced no deterministic ReSharper
-- application identity. Automated packaging cannot install or attest that
-- external IDE prerequisite, so block this package instead of publishing a
-- false standalone lifecycle or guessing at an unrelated uninstall entry.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'JetBrains.ReSharper',
  'unsupported_managed_install',
  'ReSharper is a host-dependent Visual Studio extension. Isolated LocalSystem QA used the exact machine-wide silent command, but without a qualifying Visual Studio host it produced no deterministic ReSharper application identity.',
  'https://www.jetbrains.com/help/resharper/Installation_Guide.html'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'JetBrains.ReSharper';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'JetBrains.ReSharper'
  and status in ('queued', 'failed');
