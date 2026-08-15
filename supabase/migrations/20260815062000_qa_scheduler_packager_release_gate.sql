-- Make scheduler rollouts observable and fail closed when production has not
-- yet picked up the packager revision selected by the operator.
alter table public.qa_pipeline_control
  add column if not exists required_packager_commit text,
  add column if not exists scheduler_packager_commit text,
  add column if not exists scheduler_seen_at timestamptz;

alter table public.qa_pipeline_control
  drop constraint if exists qa_pipeline_control_required_packager_commit_format,
  add constraint qa_pipeline_control_required_packager_commit_format
    check (required_packager_commit is null or required_packager_commit ~ '^[0-9a-f]{40}$'),
  drop constraint if exists qa_pipeline_control_scheduler_packager_commit_format,
  add constraint qa_pipeline_control_scheduler_packager_commit_format
    check (scheduler_packager_commit is null or scheduler_packager_commit ~ '^[0-9a-f]{40}$');

comment on column public.qa_pipeline_control.required_packager_commit is
  'Packager revision that production enqueue and dispatch code must match before mutating the queue.';
comment on column public.qa_pipeline_control.scheduler_packager_commit is
  'Packager revision most recently reported by the production enqueue scheduler.';
comment on column public.qa_pipeline_control.scheduler_seen_at is
  'Timestamp of the most recent production enqueue scheduler heartbeat.';
