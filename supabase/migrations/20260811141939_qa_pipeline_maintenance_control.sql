-- A single, private control row gives operators a deliberate maintenance
-- boundary for the one-VM QA pipeline. Both enqueue and dispatch fail closed
-- while paused, so guest maintenance cannot race a newly scheduled test.
create table if not exists public.qa_pipeline_control (
  id text primary key check (id = 'global'),
  paused boolean not null default false,
  reason text,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.qa_pipeline_control (id, paused, reason, updated_by)
values ('global', false, null, 'migration')
on conflict (id) do nothing;

alter table public.qa_pipeline_control enable row level security;

revoke all on table public.qa_pipeline_control from public, anon, authenticated;
grant select, update on table public.qa_pipeline_control to service_role;

comment on table public.qa_pipeline_control is
  'Private fail-safe maintenance control for the single-VM Intune QA pipeline.';
comment on column public.qa_pipeline_control.paused is
  'When true, scheduled enqueue and dispatch endpoints perform no queue mutation or workflow dispatch.';
