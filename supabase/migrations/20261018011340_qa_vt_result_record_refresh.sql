-- Read-only publication input. A provider verdict never grants lifecycle or release credit.
create function public.list_qa_vt_resolved_record_refreshes(p_secret text, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare stamp timestamptz := clock_timestamp(); result jsonb;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid QA refresh bound'; end if;
  select coalesce(jsonb_agg(item), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'candidate_id',c.id,'winget_id',c.winget_id,'version',c.version,'architecture',c.architecture,
      'run_id',c.github_run_id,'sha256',lower(c.installer_sha256),'profile_sha256',c.package_profile_sha256,
      'source',proof.source,'reservation_id',proof.reservation_id,
      'malicious',r.malicious,'suspicious',r.suspicious,'total_engines',r.total_engines,
      'analyzed_at',r.analyzed_at,'checked_at',r.checked_at) as item
    from public.qa_candidates c
    join public.catalog_file_reputation r on r.sha256=lower(c.installer_sha256)
    cross join lateral (
      select evidence.source,evidence.reservation_id from (
        select 'metadata'::text as source,m.reservation_id,0 as priority
        from public.qa_vt_metadata_rechecks m
        where m.candidate_id=c.id and m.run_id=c.github_run_id and m.sha256=lower(c.installer_sha256)
          and upper(m.profile_sha256)=upper(c.package_profile_sha256)
          and m.state='resolved' and m.last_http_status=200
          and (m.malicious,m.suspicious,m.total_engines,m.analyzed_at,m.checked_at)
            =(r.malicious,r.suspicious,r.total_engines,r.analyzed_at,r.checked_at)
        union all
        select 'terminal'::text,q.id,1
        from public.qa_vt_requests q join public.qa_vt_submission_intents i on i.sha256=q.sha256
        where q.candidate_id=c.id and i.candidate_id=c.id and q.sha256=lower(c.installer_sha256)
          and public.qa_vt_submission_identity(c.id,q.sha256)
          and i.profile_sha256=c.package_profile_sha256 and i.github_run_id=c.github_run_id
          and q.recheck_lease is null and q.metadata_candidate_id is null
          and q.operation='hash_lookup' and q.reserved_at>=c.finished_at
          -- Exact equality is the completion writer's atomic HTTP200 proof.
          -- HTTP0/202/404/429 never write a found cache row at this same stamp.
          and q.response_recorded_at is not null
          and q.response_recorded_at=r.checked_at and q.response_recorded_at>=q.reserved_at
      ) evidence order by evidence.priority,evidence.reservation_id nulls last limit 1
    ) proof
    where c.test_level='psadt-package' and c.status='error' and c.phase='publishing' and c.finished_at is not null
      and c.package_profile_sha256 ~ '^[A-Fa-f0-9]{64}$' and c.github_run_id ~ '^[1-9][0-9]*$'
      and r.status='found' and r.engine_count_version=2
      and r.malicious=0 and r.suspicious=0 and r.total_engines between 1 and 9999
      and isfinite(r.analyzed_at) and isfinite(r.checked_at) and r.analyzed_at<=r.checked_at
      and r.checked_at>stamp-interval '7 days' and r.checked_at<=stamp and r.retry_after>stamp
    order by c.finished_at,c.id limit p_limit
  ) eligible;
  return result;
end;
$$;
revoke all on function public.list_qa_vt_resolved_record_refreshes(text,integer) from public,authenticated;
grant execute on function public.list_qa_vt_resolved_record_refreshes(text,integer) to anon,service_role;
