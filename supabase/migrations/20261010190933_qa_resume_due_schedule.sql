-- Apply before deploying the due-time filter in qa-resume.
alter table public.packaging_jobs
  add column qa_resume_due_at timestamptz not null default now();
comment on column public.packaging_jobs.qa_resume_due_at is
  'Earliest qa-resume evaluation time. Ignored outside awaiting_qa.';
update public.packaging_jobs
  set qa_resume_due_at = created_at where status = 'awaiting_qa';
create index idx_packaging_jobs_qa_resume_due
  on public.packaging_jobs (qa_resume_due_at, id) where status = 'awaiting_qa';
