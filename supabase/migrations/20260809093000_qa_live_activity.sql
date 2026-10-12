-- Bounded, sanitized before/after evidence for the public live QA dashboard.
alter table public.qa_candidates
  add column if not exists live_activity jsonb,
  add column if not exists activity_updated_at timestamptz;

create or replace function public.publish_qa_candidate_activity(
  p_secret text,
  p_candidate_id uuid,
  p_activity jsonb,
  p_observed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  expected_secret_hash constant text := 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921';
  updated_count integer;
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;
  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    raise exception 'Invalid QA activity observation time';
  end if;
  if p_activity is null or jsonb_typeof(p_activity) <> 'object'
    or p_activity->>'stage' not in ('after_install', 'after_uninstall')
    or jsonb_typeof(p_activity->'counts') <> 'object'
    or jsonb_typeof(p_activity->'items') <> 'array'
    or jsonb_array_length(p_activity->'items') > 40
    or jsonb_typeof(p_activity->'truncated') <> 'boolean'
    or octet_length(p_activity::text) > 16384 then
    raise exception 'Invalid QA activity payload';
  end if;
  if exists (
    select 1
    from unnest(array[
      'registryAdded', 'registryChanged', 'registryRemoved',
      'filesAdded', 'filesChanged', 'filesRemoved'
    ]) count_name
    where jsonb_typeof(p_activity->'counts'->count_name) <> 'number'
      or (p_activity->'counts'->>count_name)::numeric < 0
      or (p_activity->'counts'->>count_name)::numeric > 50000000
      or trunc((p_activity->'counts'->>count_name)::numeric) <> (p_activity->'counts'->>count_name)::numeric
  ) then
    raise exception 'Invalid QA activity counts';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_activity->'items') item
    where jsonb_typeof(item) <> 'object'
      or item->>'kind' not in ('file', 'registry')
      or item->>'change' not in ('added', 'changed', 'removed')
      or length(coalesce(item->>'target', '')) not between 1 and 240
      or item->>'target' ~ '[[:cntrl:]]'
      or item->>'target' !~* '^(%(PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|WINDIR|PUBLIC|USERPROFILE)%\\|HK(LM|CU)\\)'
  ) then
    raise exception 'Invalid QA activity item';
  end if;

  update public.qa_candidates
  set live_activity = p_activity,
      activity_updated_at = p_observed_at,
      updated_at = greatest(updated_at, p_observed_at)
  where id = p_candidate_id
    and status in ('dispatched', 'running')
    and (activity_updated_at is null or p_observed_at > activity_updated_at);
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.publish_qa_candidate_activity(text, uuid, jsonb, timestamptz)
  from public, authenticated, service_role;
grant execute on function public.publish_qa_candidate_activity(text, uuid, jsonb, timestamptz)
  to anon;

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
      live_activity = null,
      activity_updated_at = null,
      updated_at = now()
  where id = p_candidate_id and status = 'dispatched';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.mark_qa_candidate_running(text, uuid, text, text)
  from public, authenticated, service_role;
grant execute on function public.mark_qa_candidate_running(text, uuid, text, text)
  to anon;
