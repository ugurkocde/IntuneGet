-- Release only the caller's unstarted, unexhausted dispatch lease.
create function public.release_qa_candidate_dispatch_lease(
  p_secret text, p_candidate_id uuid, p_run_id text, p_dispatched_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  if p_dispatched_at is null or p_run_id is null or p_run_id !~ '^[0-9]+$' then
    return 'not_owned';
  end if;
  if exists (
    select 1 from public.qa_candidates c
    where c.id = p_candidate_id and c.status = 'running'
      and c.github_run_id = p_run_id and c.dispatched_at = p_dispatched_at
  ) then
    return 'owned_running';
  end if;
  update public.qa_candidates c set status = 'queued', dispatched_at = null,
    phase = null, phase_started_at = null, phase_updated_at = null,
    failure_summary = 'The installation test could not start; retry scheduled.',
    updated_at = pg_catalog.now()
  where c.id = p_candidate_id and c.status = 'dispatched'
    and c.dispatched_at = p_dispatched_at and c.started_at is null
    and c.github_run_id is null and c.test_level = 'psadt-package' and c.attempts < 2;
  if found then return 'released'; end if;
  return 'not_owned';
end;
$$;
revoke all on function public.release_qa_candidate_dispatch_lease(text,uuid,text,timestamptz)
  from public, authenticated, service_role;
grant execute on function public.release_qa_candidate_dispatch_lease(text,uuid,text,timestamptz) to anon;
