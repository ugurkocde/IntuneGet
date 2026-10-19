-- Validate only receipt-backed candidates before invoking dependency identity checks.
create or replace function public.admit_qa_vt_dependency_rechecks(p_secret text) returns integer
language plpgsql security definer set search_path='' as $$
declare written integer; new_hashes text[];
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  with eligible as materialized (
    select c.id,c.finished_at from public.qa_candidates c
    where c.finished_at>=statement_timestamp()-interval '14 days'
      and exists(select 1 from public.qa_dependency_execution_receipts r
        where r.candidate_id=c.id and r.run_id=c.github_run_id)
  ), created as (insert into public.qa_vt_dependency_demands(candidate_id,run_id,run_attempt,profile_sha256,sha256,package_identifier,dep_order)
    select c.id,e.run_id,e.run_attempt,e.profile_sha256,e.sha256,e.package_identifier,e.dep_order
    from eligible c cross join lateral public.qa_vt_installed_dependency_entries(c.id) e
    where not exists(select 1 from public.qa_vt_dependency_demands d where d.candidate_id=c.id and d.run_id=e.run_id and d.run_attempt=e.run_attempt and d.sha256=e.sha256)
    order by c.finished_at,c.id,e.dep_order limit 100
    on conflict(candidate_id,run_id,run_attempt,sha256) do nothing returning sha256)
    select count(*)::integer,array_agg(distinct created.sha256) into written,new_hashes from created;
  insert into public.qa_vt_dependency_rechecks(sha256)
    select unnest(new_hashes)
    on conflict(sha256) do update set state='pending',retry_at=clock_timestamp(),
      first_queued_at=clock_timestamp(),attempts=0,lease=null,lease_expires_at=null,reservation_id=null,last_http_status=null
    -- A new run/attempt's demand may start a new finite lookup cycle only
    -- after a formerly resolved verdict expires. Re-admission of the same
    -- tuple, not_found and exhausted/escalated rows can never reset a cycle.
    where qa_vt_dependency_rechecks.state='resolved' and not exists(
      select 1 from public.catalog_file_reputation r where r.sha256=excluded.sha256 and r.status='found'
        and r.engine_count_version=2 and r.malicious between 0 and 9999 and r.suspicious between 0 and 9999
        and r.total_engines between 1 and 9999 and r.malicious::bigint+r.suspicious::bigint<=r.total_engines
        and r.analyzed_at<=clock_timestamp() and r.checked_at>clock_timestamp()-interval '7 days'
        and r.checked_at<=clock_timestamp() and r.retry_after>clock_timestamp());
  return written;
end;
$$;
revoke all on function public.admit_qa_vt_dependency_rechecks(text) from public,anon,authenticated,service_role;
grant execute on function public.admit_qa_vt_dependency_rechecks(text) to anon,service_role;
