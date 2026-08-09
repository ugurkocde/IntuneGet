-- Demand-driven QA: customer packaging jobs wait on a tenant-independent,
-- behavior-affecting PSADT execution profile. Presentation choices are kept
-- separately so branding changes do not multiply isolated VM runs.

alter table public.packaging_jobs
  add column if not exists execution_profile_sha256 text,
  add column if not exists presentation_profile_sha256 text,
  add column if not exists qa_candidate_id uuid references public.qa_candidates(id) on delete set null,
  add column if not exists qa_requested_at timestamptz,
  add column if not exists qa_completed_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'packaging_jobs_execution_profile_sha256_check') then
    alter table public.packaging_jobs add constraint packaging_jobs_execution_profile_sha256_check
      check (execution_profile_sha256 is null or execution_profile_sha256 ~ '^[A-F0-9]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packaging_jobs_presentation_profile_sha256_check') then
    alter table public.packaging_jobs add constraint packaging_jobs_presentation_profile_sha256_check
      check (presentation_profile_sha256 is null or presentation_profile_sha256 ~ '^[A-F0-9]{64}$');
  end if;
end $$;

create index if not exists idx_packaging_jobs_awaiting_qa
  on public.packaging_jobs(qa_candidate_id, created_at)
  where status = 'awaiting_qa';

alter table public.qa_candidates
  add column if not exists demand_source text not null default 'catalog';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'qa_candidates_demand_source_check') then
    alter table public.qa_candidates add constraint qa_candidates_demand_source_check
      check (demand_source in ('customer', 'auto_update', 'managed', 'operator', 'catalog'));
  end if;
end $$;

create index if not exists qa_candidates_demand_dispatch_idx
  on public.qa_candidates(demand_source, priority desc, enqueued_at)
  where status = 'queued';

comment on column public.packaging_jobs.execution_profile_sha256 is
  'Behavior-affecting PSADT QA identity. Equal profiles may reuse one isolated VM result.';
comment on column public.packaging_jobs.presentation_profile_sha256 is
  'Presentation-only PSADT identity retained for audit without forcing another VM run.';
comment on column public.packaging_jobs.qa_candidate_id is
  'Tenant-independent QA candidate currently gating this packaging job.';
