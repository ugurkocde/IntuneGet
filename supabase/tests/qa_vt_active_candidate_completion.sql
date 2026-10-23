-- Disposable fixture only. The old completion must reject the first call.
begin;
do $$
declare cid uuid:='85100000-0000-4000-8000-000000000001'; rid uuid;
  h text:=repeat('8',64); analysis timestamptz:=date_trunc('second',now()-interval '1 day');
  before_metadata jsonb; saved_request jsonb; case_name text; rejected boolean; cached jsonb;
begin
  insert into public.qa_candidates(id,winget_id,version,architecture,status,test_level,
    installer_sha256,dispatched_at,enqueued_at,attempts)
  values(cid,'Fixture.Active','1','x64','running','psadt-package',upper(h),now()-interval '1 minute',now()-interval '2 minutes',1);
  insert into public.qa_vt_requests(sha256,operation,candidate_id,reserved_at)
    values(h,'hash_lookup',cid,clock_timestamp()) returning id into rid;
  select coalesce(jsonb_agg(to_jsonb(m)),'[]') into before_metadata from public.qa_vt_metadata_rechecks m;
  perform public.complete_qa_vt_metadata_recheck('local-fixture-only',rid,200,null,0,0,61,analysis);
  if not exists(select 1 from public.catalog_file_reputation where sha256=h and engine_count_version=2
    and total_engines=61 and analyzed_at=analysis and malicious=0 and suspicious=0)
    or not exists(select 1 from public.qa_vt_requests where id=rid and response_recorded_at is not null)
    then raise exception 'Active exact lookup not persisted';end if;
  if before_metadata is distinct from (select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.qa_vt_metadata_rechecks m)
    then raise exception 'Active completion changed metadata state';end if;
  cached:=public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'hash_lookup');
  if cached->'cached' is null then raise exception 'Completed lookup was not reused';end if;
  rejected:=false;
  begin perform public.complete_qa_vt_metadata_recheck('local-fixture-only',rid,200,null,0,0,61,analysis);
  exception when others then rejected:=true;end;
  if not rejected then raise exception 'Consumed reservation replay accepted';end if;
  insert into qa_result_publication_fixture values(h,'clean',0,0,analysis,clock_timestamp());
  if not exists(select 1 from public.catalog_file_reputation where sha256=h and engine_count_version=2 and total_engines=61)
    then raise exception 'Publication trigger downgraded exact evidence';end if;
  delete from public.catalog_file_reputation where sha256=h;
  update public.qa_vt_requests set response_recorded_at=null where id=rid;
  select to_jsonb(r) into saved_request from public.qa_vt_requests r where id=rid;
  foreach case_name in array array['hash','operation','dispatch_null','requeue','stale','future','metadata','recheck','status','terminal','mode','http','retry','counts','date'] loop
    rejected:=false;
    begin
      if case_name='hash' then update public.qa_candidates set installer_sha256=repeat('9',64) where id=cid;
      elsif case_name='operation' then update public.qa_vt_requests set operation='analysis_lookup' where id=rid;
      elsif case_name='dispatch_null' then update public.qa_candidates set dispatched_at=null where id=cid;
      elsif case_name='requeue' then update public.qa_candidates set dispatched_at=clock_timestamp()+interval '1 second' where id=cid;
      elsif case_name='stale' then update public.qa_vt_requests set reserved_at=now()-interval '3 minutes' where id=rid;
      elsif case_name='future' then update public.qa_vt_requests set reserved_at=now()+interval '1 minute' where id=rid;
      elsif case_name='metadata' then update public.qa_vt_requests set metadata_candidate_id=cid where id=rid;
      elsif case_name='recheck' then update public.qa_vt_requests set recheck_lease=gen_random_uuid() where id=rid;
      elsif case_name='status' then update public.qa_candidates set status='queued' where id=cid;
      elsif case_name='terminal' then update public.qa_candidates set status='error',finished_at=clock_timestamp() where id=cid;
      elsif case_name='mode' then update public.qa_candidates set test_level='metadata' where id=cid;
      end if;
      perform public.complete_qa_vt_metadata_recheck('local-fixture-only',rid,
        case when case_name='http' then 0 else 200 end,
        case when case_name='retry' then now()+interval '1 day' else null end,
        0,0,case when case_name='counts' then 0 else 61 end,
        case when case_name='date' then now()+interval '1 day' else analysis end);
      raise exception 'UNEXPECTED_ACCEPT';
    exception when others then
      if sqlerrm='UNEXPECTED_ACCEPT' then raise exception 'Active rejection missing: %',case_name;end if;
      rejected:=true;
    end;
    if not rejected or exists(select 1 from public.catalog_file_reputation where sha256=h)
      or exists(select 1 from public.qa_vt_requests where id=rid and response_recorded_at is not null)
      then raise exception 'Rejected response changed state: %',case_name;end if;
  end loop;
  -- A newer qualified v2 wins without overwrite, but the exact request is consumed.
  insert into public.catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,engine_count_version,analyzed_at,checked_at,retry_after)
    values(h,'found',0,0,70,2,analysis+interval '1 hour',now(),now()+interval '7 days');
  perform public.complete_qa_vt_metadata_recheck('local-fixture-only',rid,200,null,0,0,61,analysis);
  if not exists(select 1 from public.catalog_file_reputation where sha256=h and total_engines=70)
    then raise exception 'Newer evidence overwritten';end if;
  update public.qa_vt_requests set response_recorded_at=null where id=rid;
  update public.catalog_file_reputation set engine_count_version=1,total_engines=null where sha256=h;
  rejected:=false;
  begin perform public.complete_qa_vt_metadata_recheck('local-fixture-only',rid,200,null,0,0,61,analysis);
  exception when others then rejected:=true;end;
  if not rejected or exists(select 1 from public.qa_vt_requests where id=rid and response_recorded_at is not null)
    then raise exception 'Newer unqualified evidence accepted';end if;
  delete from public.catalog_file_reputation where sha256=h;
  perform public.complete_qa_vt_metadata_recheck('local-fixture-only',rid,200,null,1,0,61,analysis);
  if not exists(select 1 from public.qa_installer_security_holds where sha256=h and released_at is null and malicious_verdicts=1)
    then raise exception 'Flagged lookup failed to hold';end if;
end;
$$;
rollback;
