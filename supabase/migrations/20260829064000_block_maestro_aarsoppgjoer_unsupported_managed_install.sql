-- Maestro Arsoppgjor 2025 does not currently provide a verifiable unattended
-- machine installation lifecycle. Two isolated PSADT runs used consecutive,
-- exact WinGet payloads (38.05.21 and 38.05.22) with the published /s switch.
-- Both ran for roughly 90 seconds under LocalSystem, changed only Microsoft
-- Edge/WebView2 registrations, and created no Maestro application identity for
-- managed detection or removal. Keep the package out of customer packaging and
-- QA until the upstream manifest or vendor publishes a deterministic contract.

insert into public.package_eligibility_blocks (
  winget_id,
  block_code,
  detail,
  source_url
)
values (
  'MaestroSoft.MaestroAarsoppgjoer.2025',
  'unsupported_managed_install',
  'Two consecutive exact WinGet payloads (38.05.21 and 38.05.22) ran the published /s command under LocalSystem but changed only Microsoft Edge/WebView2 registrations and created no Maestro application identity for deterministic detection or managed removal.',
  'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/33238254434'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'MaestroSoft.MaestroAarsoppgjoer.2025';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'MaestroSoft.MaestroAarsoppgjoer.2025'
  and status in ('queued', 'failed', 'error');
