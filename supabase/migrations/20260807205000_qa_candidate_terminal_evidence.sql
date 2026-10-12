-- Preserve the final protected workflow reference when an infrastructure
-- retry exhausts its two attempts. A retry that is actually re-queued still
-- clears per-attempt execution metadata before the next dispatch.
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

revoke all on function public.report_qa_candidate_result(text, uuid, text, text)
  from public, authenticated, service_role;
grant execute on function public.report_qa_candidate_result(text, uuid, text, text) to anon;
