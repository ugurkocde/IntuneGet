-- The recent-results read must use an ordered index instead of sorting history.
BEGIN;
SET LOCAL enable_seqscan = off;
DO $$
DECLARE plan json;
BEGIN
  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT winget_id, package_profile_sha256,
    tested_version, architecture, installer_sha256, outcome, tested_at_utc,
    overall_duration_seconds, virustotal_status
    FROM public.qa_package_results ORDER BY tested_at_utc DESC LIMIT 50' INTO plan;
  IF plan::text LIKE '%"Node Type": "Sort"%' OR plan::text NOT LIKE '%Index Scan%' THEN
    RAISE EXCEPTION 'The recent QA results query requires an ordered index scan';
  END IF;
END $$;
ROLLBACK;
