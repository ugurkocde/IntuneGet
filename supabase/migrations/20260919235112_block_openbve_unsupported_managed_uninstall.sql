-- OpenBVE 1.14.0.3 x64 failed isolated LocalSystem QA run 35476260200:
-- install/detect/uninstall/removal = 0/0/60001/0. Exact Inno registration
-- {D617A45D-C2F6-44D1-A85C-CA7FFA91F7FC}_is1 remained after 310 seconds.
-- The release-tagged InitializeUninstall calls an unconditional MsgBox.
-- Inno documents that /SUPPRESSMSGBOXES cannot suppress scripted MsgBox:
-- https://jrsoftware.org/ishelp/topic_setupcmdline.htm
-- Block the shared customer/QA path until a reviewed unattended removal
-- contract exists. Preserve terminal failure evidence and security blocks.

insert into public.package_eligibility_blocks (
  winget_id, block_code, detail, source_url
)
values (
  'leezer3.OpenBVE',
  'unsupported_managed_uninstall',
  'OpenBVE uses an unconditional scripted message box during uninstall that is not suppressed by Inno silent switches. Version 1.14.0.3 x64 retained its exact installed registration after the bounded LocalSystem uninstall deadline. A supported unattended removal contract is required before automated deployment can be enabled.',
  'https://github.com/leezer3/OpenBVE/blob/1.14.0.3/installers/windows/openbve.iss'
)
on conflict (winget_id) do update
set block_code = excluded.block_code,
    detail = excluded.detail,
    source_url = excluded.source_url,
    updated_at = now();

update public.curated_apps
set is_verified = false
where winget_id = 'leezer3.OpenBVE';

update public.qa_candidates
set status = 'superseded',
    finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app is not available for automated deployment.',
    updated_at = now()
where winget_id = 'leezer3.OpenBVE'
  and status = 'queued'
  and dispatched_at is null
  and github_run_id is null;
