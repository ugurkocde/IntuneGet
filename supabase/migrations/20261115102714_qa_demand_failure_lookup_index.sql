-- Bound the current-version failure lookup without changing demand eligibility.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';
CREATE INDEX qa_candidates_psadt_failure_idx ON public.qa_candidates(winget_id)
  INCLUDE(version, catalog_version_at_enqueue, finished_at)
  WHERE test_level = 'psadt-package' AND status IN ('failed', 'error');
ANALYZE public.qa_candidates;
