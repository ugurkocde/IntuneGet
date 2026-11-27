-- Fence already-admitted candidates before the opaque terminal-identity gate
-- and add a narrow partial index for recent publishing candidates so routine
-- VT metadata admission avoids full qa_candidates scans and avoids re-calling
-- qa_vt_terminal_identity() on already-admitted rows.
-- Authentication, advisory lock, authoritative identity gate, customer-first
-- ordering, batch limit and ACLs remain unchanged.
create index if not exists qa_candidates_vt_terminal_admission_idx
  on public.qa_candidates (finished_at, id)
  where test_level = 'psadt-package'
    and phase = 'publishing'
    and status in ('error', 'failed', 'passed')
    and finished_at is not null;

create or replace function public.admit_qa_vt_terminal_metadata_rechecks(p_secret text)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare inserted integer; stamp timestamptz;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  stamp:=clock_timestamp();
  with unadmitted as materialized (
    select c.id, lower(c.installer_sha256) as sha256, c.package_profile_sha256, c.github_run_id, c.finished_at
    from public.qa_candidates c
    where c.test_level = 'psadt-package'
      and c.phase = 'publishing'
      and c.status in ('error', 'failed', 'passed')
      and c.finished_at is not null
      and c.finished_at >= stamp - interval '14 days'
      and c.finished_at <= statement_timestamp()
      and c.dispatched_at is not null
      and c.attempts is not null
      and c.github_run_id ~ '^[1-9][0-9]*$'
      and c.package_profile_sha256 ~ '^[A-Fa-f0-9]{64}$'
      and lower(c.installer_sha256) ~ '^[a-f0-9]{64}$'
      and lower(c.installer_sha256) <> repeat('0', 64)
      and not exists (
        select 1
        from public.qa_vt_metadata_rechecks q
        where q.candidate_id = c.id and q.run_id = c.github_run_id
      )
  )
  insert into public.qa_vt_metadata_rechecks(candidate_id, sha256, profile_sha256, run_id, retry_at, last_http_status)
  select u.id, u.sha256, u.package_profile_sha256, u.github_run_id, stamp, null
  from unadmitted u
  where public.qa_vt_terminal_identity(u.id)
  order by exists(select 1 from public.packaging_jobs j where j.qa_candidate_id = u.id and j.status = 'awaiting_qa') desc,
    u.finished_at, u.id
  limit 100
  on conflict(candidate_id, run_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end;
$function$;
