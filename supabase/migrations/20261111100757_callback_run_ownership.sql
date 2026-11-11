-- Apply before deploying the callback owner fence. Existing jobs remain unowned.
ALTER TABLE public.packaging_jobs ADD COLUMN callback_run_id text NULL;
