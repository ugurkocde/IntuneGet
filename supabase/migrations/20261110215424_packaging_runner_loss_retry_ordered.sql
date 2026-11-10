-- Apply before deploying early customer runner reconciliation.
ALTER TABLE public.packaging_jobs
  ADD COLUMN infrastructure_retry_count smallint NOT NULL DEFAULT 0
    CHECK (infrastructure_retry_count BETWEEN 0 AND 1),
  ADD COLUMN infrastructure_retry_run_id text;
