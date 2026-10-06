-- Exact-release compatibility quarantine using the existing shared QA/customer gate.
-- Published evidence: IntuneGet-Workflows/qa/results/anaconda.anaconda3.json
-- https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/37428393225
-- Official arguments: https://conda.github.io/constructor/cli-options/
-- Installation stalled under LocalSystem; no evidence-backed adapter change
-- is established. Preserve terminal evidence and all dispatched work.
insert into public.qa_package_blocks (
  winget_id, version, architecture, installer_sha256, block_code, detail
) values (
  'Anaconda.Anaconda3', '2026.07-1', 'x64',
  'B545F4BD8AB3BF32D99002A0779A887668EBFE479EE32ECBF060375670D5EE09',
  'failed_managed_lifecycle',
  'This installer did not complete automated installation under LocalSystem: run 37428393225 stalled after 921 seconds and returned install/detection/uninstall/removal exits -1/1/0/1. The exact vendor registration was removed successfully. The installation root cause is unconfirmed; this exact payload is held until a reviewed repair and strict lifecycle retest are available. File reputation was unavailable, not a clean or malicious verdict.'
)
on conflict (winget_id, version, architecture, installer_sha256) do nothing;

update public.qa_candidates
set status = 'superseded', finished_at = coalesce(finished_at, now()),
    failure_summary = 'This app version is not available for automated deployment.',
    updated_at = now()
where winget_id = 'Anaconda.Anaconda3'
  and version = '2026.07-1' and architecture = 'x64'
  and installer_sha256 = 'B545F4BD8AB3BF32D99002A0779A887668EBFE479EE32ECBF060375670D5EE09'
  and status = 'queued' and dispatched_at is null and github_run_id is null;
