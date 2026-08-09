-- Sanitized PSADT log tail for the public live QA dashboard.
alter table public.qa_candidates
  add column if not exists live_log jsonb,
  add column if not exists log_updated_at timestamptz;

create or replace function public.publish_qa_candidate_log(
  p_secret text,
  p_candidate_id uuid,
  p_log jsonb,
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
  last_write_at timestamptz;
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;
  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    raise exception 'Invalid QA log observation time';
  end if;
  if p_log is null or jsonb_typeof(p_log) <> 'object'
    or p_log->>'source' <> 'PSADT'
    or jsonb_typeof(p_log->'lines') <> 'array'
    or jsonb_array_length(p_log->'lines') > 8
    or octet_length(p_log::text) > 4096 then
    raise exception 'Invalid QA log payload';
  end if;
  begin
    last_write_at := (p_log->>'lastWriteAt')::timestamptz;
  exception when others then
    raise exception 'Invalid QA log timestamp';
  end;
  if last_write_at < now() - interval '1 day' or last_write_at > now() + interval '5 minutes' then
    raise exception 'Invalid QA log timestamp';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_log->'lines') line
    where jsonb_typeof(line) <> 'string'
      or length(line #>> '{}') not between 1 and 180
      or (line #>> '{}') ~ '[[:cntrl:]]'
      or (line #>> '{}') ~* '([A-Z]:\\|INTUNE-QA\\)'
  ) then
    raise exception 'Invalid QA log line';
  end if;

  update public.qa_candidates
  set live_log = p_log,
      log_updated_at = p_observed_at,
      updated_at = greatest(updated_at, p_observed_at)
  where id = p_candidate_id
    and status in ('dispatched', 'running')
    and (log_updated_at is null or p_observed_at > log_updated_at);
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.publish_qa_candidate_log(text, uuid, jsonb, timestamptz)
  from public, authenticated, service_role;
grant execute on function public.publish_qa_candidate_log(text, uuid, jsonb, timestamptz)
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
      live_log = null,
      log_updated_at = null,
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
