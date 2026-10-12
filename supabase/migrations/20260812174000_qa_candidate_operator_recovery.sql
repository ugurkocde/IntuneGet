-- Allow the protected GitHub operator workflow to re-queue a terminal QA
-- infrastructure failure without exposing a broad database credential.
create or replace function public.recover_qa_candidate(
  p_secret text,
  p_candidate_id uuid
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
  set status = 'queued',
      attempts = 0,
      dispatched_at = null,
      started_at = null,
      finished_at = null,
      github_run_id = null,
      github_run_url = null,
      phase = null,
      phase_started_at = null,
      phase_updated_at = null,
      live_activity = null,
      activity_updated_at = null,
      live_log = null,
      log_updated_at = null,
      failure_summary = null,
      updated_at = now()
  where id = p_candidate_id
    and test_level = 'psadt-package'
    and status in ('error', 'superseded');
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.recover_qa_candidate(text, uuid)
  from public, authenticated, service_role;
grant execute on function public.recover_qa_candidate(text, uuid) to anon;
