-- Keep a durable, service-only audit trail for every WinGet QA polling cycle.
-- Recipe-level errors can contain upstream details, so this table is not
-- exposed to anonymous or authenticated Data API clients.
create table public.qa_poll_runs (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  status text not null default 'running' check (
    status in ('running', 'succeeded', 'partial', 'failed')
  ),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  recipe_count integer not null default 0 check (recipe_count >= 0),
  checked_count integer not null default 0 check (checked_count >= 0),
  updates_found_count integer not null default 0 check (updates_found_count >= 0),
  queued_count integer not null default 0 check (queued_count >= 0),
  already_known_count integer not null default 0 check (already_known_count >= 0),
  unavailable_count integer not null default 0 check (unavailable_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  errors jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  alert_delivery jsonb,
  created_at timestamptz not null default now(),
  check (
    (status = 'running' and finished_at is null and duration_ms is null)
    or
    (status <> 'running' and finished_at is not null and duration_ms is not null)
  )
);

create index qa_poll_runs_started_at_idx
  on public.qa_poll_runs(started_at desc);

create index qa_poll_runs_attention_idx
  on public.qa_poll_runs(started_at desc)
  where status in ('partial', 'failed');

comment on table public.qa_poll_runs is
  'Service-only operational history for each scheduled WinGet QA polling invocation.';

alter table public.qa_poll_runs enable row level security;

revoke all on table public.qa_poll_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.qa_poll_runs to service_role;
