-- ReSharper EAP 2021.2 EAP 8 is a Visual Studio extension rather than a
-- standalone application. Its WinGet command explicitly targets Visual Studio
-- 2019 (/VsVersion=16.0). Isolated LocalSystem QA run 32472961245 invoked the
-- vendor-documented silent command exactly, but the clean VM has no qualifying
-- Visual Studio host: the installer returned -1, created no ReSharper product
-- registration, and left no deterministic uninstall identity. JetBrains also
-- documents that ReSharper installs into selected Visual Studio versions.
-- Automated packaging cannot install or attest that external IDE prerequisite,
-- so block this package instead of publishing a false standalone lifecycle.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'JetBrains.ReSharper.EAP',
  'unsupported_managed_install',
  'ReSharper EAP is a host-dependent Visual Studio extension. Its exact vendor-documented silent command targets Visual Studio 2019, but isolated LocalSystem QA without that external IDE host returned -1 and produced no deterministic managed application identity.',
  'https://www.jetbrains.com/help/resharper/Installation_Guide.html'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'JetBrains.ReSharper.EAP';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'JetBrains.ReSharper.EAP'
  and status in ('queued', 'failed');
