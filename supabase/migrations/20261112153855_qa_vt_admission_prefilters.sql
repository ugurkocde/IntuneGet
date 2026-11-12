-- Apply cheap implied filters before the opaque terminal-identity gate.
-- Keep the authoritative gate, authentication, lock and admission order intact.
CREATE OR REPLACE FUNCTION public.admit_qa_vt_terminal_metadata_rechecks(p_secret text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inserted integer; stamp timestamptz;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  stamp:=clock_timestamp();
  insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at,last_http_status)
  select c.id,lower(c.installer_sha256),c.package_profile_sha256,c.github_run_id,stamp,null
  from public.qa_candidates c
  where c.test_level='psadt-package'
    and c.phase='publishing'
    and c.status in ('error','failed','passed')
    and c.finished_at is not null
    and c.finished_at>=stamp-interval '14 days'
    and public.qa_vt_terminal_identity(c.id)
    and not exists(select 1 from public.qa_vt_metadata_rechecks q
      where q.candidate_id=c.id and q.run_id=c.github_run_id)
  order by exists(select 1 from public.packaging_jobs j where j.qa_candidate_id=c.id and j.status='awaiting_qa') desc,
    c.finished_at,c.id limit 100
  on conflict(candidate_id,run_id) do nothing;
  get diagnostics inserted=row_count;
  return inserted;
end;
$function$
