-- Bind public QA results to the exact installer payload and add the small,
-- idempotent release-candidate queue used by the 10-minute QA automation.
alter table public.qa_results
  add column if not exists installer_sha256 text
  check (installer_sha256 is null or installer_sha256 ~ '^[A-F0-9]{64}$');

create table public.qa_recipes (
  winget_id text primary key,
  definition_path text not null check (
    definition_path ~ '^qa/apps/[A-Za-z0-9._+-]+\.json$'
  ),
  architecture text not null check (architecture in ('x64', 'x86', 'arm64')),
  installer_type text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on table public.qa_recipes is
  'Public, non-secret index of the application definitions supported by isolated QA automation.';

create table public.qa_candidates (
  id uuid primary key default gen_random_uuid(),
  winget_id text not null references public.qa_recipes(winget_id),
  definition_path text not null,
  version text not null,
  architecture text not null check (architecture in ('x64', 'x86', 'arm64')),
  installer_url text not null check (installer_url ~ '^https://'),
  installer_sha256 text not null check (installer_sha256 ~ '^[A-F0-9]{64}$'),
  installer_type text not null,
  installer_file_name text not null check (
    installer_file_name <> '' and installer_file_name !~ '[\\/:*?"<>|]'
  ),
  status text not null default 'queued' check (
    status in ('queued', 'dispatched', 'running', 'passed', 'failed', 'error', 'superseded')
  ),
  priority integer not null default 0,
  attempts integer not null default 0 check (attempts >= 0),
  enqueued_at timestamptz not null default now(),
  dispatched_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  github_run_id text,
  github_run_url text,
  failure_summary text,
  updated_at timestamptz not null default now(),
  unique (winget_id, version, architecture, installer_sha256)
);

create index qa_candidates_dispatch_idx
  on public.qa_candidates(priority desc, enqueued_at asc)
  where status = 'queued';
create index qa_candidates_active_idx
  on public.qa_candidates(updated_at asc)
  where status in ('dispatched', 'running');
create unique index qa_candidates_single_active_idx
  on public.qa_candidates ((true))
  where status in ('dispatched', 'running');
create index qa_candidates_app_idx
  on public.qa_candidates(winget_id, architecture, enqueued_at desc);

comment on table public.qa_candidates is
  'Exact WinGet release candidates awaiting or completing isolated Hyper-V QA.';

alter table public.qa_recipes enable row level security;
alter table public.qa_candidates enable row level security;

revoke all on table public.qa_recipes from public, anon, authenticated;
revoke all on table public.qa_candidates from public, anon, authenticated;
grant select on table public.qa_recipes to anon, authenticated;
grant select on table public.qa_candidates to anon, authenticated;
grant select, insert, update, delete on table public.qa_recipes to service_role;
grant select, insert, update, delete on table public.qa_candidates to service_role;

create policy "QA recipes are publicly readable"
  on public.qa_recipes for select to anon, authenticated using (true);
create policy "QA candidate states are publicly readable"
  on public.qa_candidates for select to anon, authenticated using (true);

-- Keep the original three-argument sync RPC working during the coordinated
-- rollout. V2 delegates its reconciliation to that function, then adds the
-- exact SHA and recipe mirror in the same transaction.
create or replace function public.sync_qa_results_v2(
  p_secret text,
  p_rows jsonb,
  p_recipes jsonb,
  p_allow_large_delete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  sync_result jsonb;
begin
  sync_result := public.sync_qa_results(p_secret, p_rows, p_allow_large_delete);

  update public.qa_results result
  set installer_sha256 = upper(row_data.installer_sha256)
  from jsonb_to_recordset(p_rows) as row_data(
    winget_id text,
    installer_sha256 text
  )
  where result.winget_id = row_data.winget_id;

  if jsonb_typeof(p_recipes) <> 'array' or jsonb_array_length(p_recipes) = 0 then
    raise exception 'At least one canonical QA recipe is required';
  end if;

  update public.qa_recipes set active = false, updated_at = now() where active = true;

  insert into public.qa_recipes (
    winget_id,
    definition_path,
    architecture,
    installer_type,
    active,
    updated_at
  )
  select
    recipe.winget_id,
    recipe.definition_path,
    recipe.architecture,
    recipe.installer_type,
    true,
    now()
  from jsonb_to_recordset(p_recipes) as recipe(
    winget_id text,
    definition_path text,
    architecture text,
    installer_type text
  )
  on conflict (winget_id) do update set
    definition_path = excluded.definition_path,
    architecture = excluded.architecture,
    installer_type = excluded.installer_type,
    active = true,
    updated_at = excluded.updated_at;

  return sync_result || jsonb_build_object('recipes', jsonb_array_length(p_recipes));
end;
$$;

create or replace function public.mark_qa_candidate_running(
  p_secret text,
  p_candidate_id uuid,
  p_run_id text,
  p_run_url text
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  expected_secret_hash constant text := 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921';
  changed integer;
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;

  update public.qa_candidates
  set status = 'running',
      started_at = now(),
      github_run_id = p_run_id,
      github_run_url = p_run_url,
      failure_summary = null,
      updated_at = now()
  where id = p_candidate_id and status = 'dispatched';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.report_qa_candidate_result(
  p_secret text,
  p_candidate_id uuid,
  p_outcome text,
  p_summary text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  expected_secret_hash constant text := 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921';
  normalized_outcome text := lower(coalesce(p_outcome, ''));
  changed integer;
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;
  if normalized_outcome not in ('passed', 'failed', 'error', 'retry') then
    raise exception 'Invalid QA candidate outcome';
  end if;

  update public.qa_candidates
  set status = case
        when normalized_outcome = 'retry' and attempts < 2 then 'queued'
        when normalized_outcome = 'retry' then 'error'
        else normalized_outcome
      end,
      dispatched_at = case when normalized_outcome = 'retry' and attempts < 2 then null else dispatched_at end,
      started_at = case when normalized_outcome = 'retry' and attempts < 2 then null else started_at end,
      github_run_id = case when normalized_outcome = 'retry' and attempts < 2 then null else github_run_id end,
      github_run_url = case when normalized_outcome = 'retry' and attempts < 2 then null else github_run_url end,
      finished_at = case when normalized_outcome = 'retry' and attempts < 2 then null else now() end,
      failure_summary = case when normalized_outcome = 'passed' then null else left(p_summary, 1000) end,
      updated_at = now()
  where id = p_candidate_id and status in ('dispatched', 'running');
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean)
  from public, authenticated, service_role;
revoke all on function public.mark_qa_candidate_running(text, uuid, text, text)
  from public, authenticated, service_role;
revoke all on function public.report_qa_candidate_result(text, uuid, text, text)
  from public, authenticated, service_role;

grant execute on function public.sync_qa_results_v2(text, jsonb, jsonb, boolean) to anon;
grant execute on function public.mark_qa_candidate_running(text, uuid, text, text) to anon;
grant execute on function public.report_qa_candidate_result(text, uuid, text, text) to anon;
