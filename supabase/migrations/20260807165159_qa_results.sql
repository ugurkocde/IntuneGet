-- Compact mirror of the canonical per-app QA JSON files in IntuneGet-Workflows.
-- This intentionally stores aggregate counts only: no changed paths, logs,
-- screenshots, installer binaries, or other test artifacts are retained.
create table public.qa_results (
  winget_id text primary key,
  display_name text not null,
  publisher text not null,
  tested_version text not null,
  architecture text not null check (architecture in ('x64', 'x86', 'arm64')),
  outcome text not null check (outcome in ('Passed', 'Failed')),
  tested_at_utc timestamptz not null,
  overall_duration_seconds numeric check (
    overall_duration_seconds is null or overall_duration_seconds >= 0
  ),
  installer_type text,
  install_command text not null,
  uninstall_command text not null,
  detection jsonb not null,
  phase_results jsonb not null,
  changes jsonb,
  relevant_event_count integer check (
    relevant_event_count is null or relevant_event_count >= 0
  ),
  environment jsonb,
  test_id text,
  github_run_id text,
  github_run_attempt integer check (
    github_run_attempt is null or github_run_attempt >= 1
  ),
  qa_schema_version integer not null default 1 check (qa_schema_version >= 1),
  synced_at timestamptz not null default now()
);

comment on table public.qa_results is
  'Latest compact Intune application QA result per WinGet package; canonical source is IntuneGet-Workflows/qa/apps/*.json.';
comment on column public.qa_results.changes is
  'Aggregate counts correlated with each test window; contains no filesystem or registry paths.';

alter table public.qa_results enable row level security;

-- New Supabase projects no longer expose public tables automatically. Keep the
-- catalog mirror explicitly read-only to clients and writable only by the
-- server-side synchronization workflow.
revoke all on table public.qa_results from public, anon, authenticated;
grant select on table public.qa_results to anon, authenticated;
grant select, insert, update, delete on table public.qa_results to service_role;

create policy "QA results are publicly readable"
  on public.qa_results
  for select
  to anon, authenticated
  using (true);
