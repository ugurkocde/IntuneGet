-- Keep this separate from the column backfill and compatible with transactional runners.
-- Bound write blocking; large installations can prebuild the index as documented.
set lock_timeout = '2s';
set statement_timeout = '15s';
do $$
begin
  if exists (
    select 1 from pg_index
    where indexrelid = to_regclass('public.idx_packaging_jobs_qa_resume_due')
      and not indisvalid
  ) then
    raise exception 'idx_packaging_jobs_qa_resume_due is invalid; drop it concurrently and retry';
  end if;
end $$;
create index if not exists idx_packaging_jobs_qa_resume_due
  on public.packaging_jobs (qa_resume_due_at, id) where status = 'awaiting_qa';
reset statement_timeout;
reset lock_timeout;
