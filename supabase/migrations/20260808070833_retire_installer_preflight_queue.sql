-- Installer-only candidates are historical preflight work and must not be
-- dispatched by the PSADT package workflow after this rollout.
update public.qa_candidates
set status = 'superseded',
    finished_at = now(),
    failure_summary = 'Superseded by PSADT package-level QA.',
    updated_at = now()
where test_level = 'installer-preflight'
  and status = 'queued';
