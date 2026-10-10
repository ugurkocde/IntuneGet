create index concurrently idx_packaging_jobs_qa_resume_due
  on public.packaging_jobs (qa_resume_due_at, id) where status = 'awaiting_qa';
