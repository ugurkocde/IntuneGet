-- The public live snapshot reads the newest results with ORDER BY tested_at_utc DESC LIMIT 50.
CREATE INDEX IF NOT EXISTS qa_package_results_tested_at_utc_idx
  ON public.qa_package_results (tested_at_utc DESC);
