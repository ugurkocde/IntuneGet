-- Run only in a disposable database. All synthetic rows are rolled back.
begin;
do $$
declare candidate uuid := '11111111-1111-4111-8111-111111111111';
  request uuid := '22222222-2222-4222-8222-222222222222'; item jsonb; stamp timestamptz;
begin
  -- Test harness supplies a local-only QA secret authentication fixture.
  insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
    package_profile_sha256,test_level,status,phase,finished_at)
  values(candidate,'Example.App','1','x64','123',repeat('a',64),repeat('B',64),'psadt-package','error','publishing',now()-interval '1 hour');
  insert into public.qa_vt_submission_intents(sha256,candidate_id,profile_sha256,github_run_id,outcome)
  values(repeat('a',64),candidate,repeat('B',64),'123','pending');
  insert into public.qa_vt_requests(id,candidate_id,sha256,operation,reserved_at)
  values(request,candidate,repeat('a',64),'hash_lookup',clock_timestamp()-interval '1 second');
  -- A real HTTP0 completion with a preexisting clean cache is never a verdict.
  insert into public.catalog_file_reputation values(repeat('a',64),'found',0,0,68,2,now()-interval '1 day',now()-interval '1 hour',now()+interval '1 day');
  perform public.complete_qa_vt_metadata_recheck('local-fixture-only',request,0);
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'HTTP0 became clean';end if;
  update public.qa_vt_requests set response_recorded_at=null,operation='analysis_lookup';
  update public.qa_vt_submission_intents set outcome='submitted',analysis_id='local-analysis',analysis_recorded_at=now()-interval '1 minute';
  perform public.complete_qa_vt_metadata_recheck('local-fixture-only',request,202);
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'HTTP202 became clean';end if;
  update public.qa_vt_requests set response_recorded_at=null;
  perform public.complete_qa_vt_metadata_recheck('local-fixture-only',request,404);
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'analysis404 became clean';end if;
  update public.qa_vt_requests set response_recorded_at=null,operation='hash_lookup';
  update public.qa_vt_submission_intents set outcome='pending';
  update public.qa_vt_requests set response_recorded_at=null;
  perform public.complete_qa_vt_metadata_recheck('local-fixture-only',request,200,null,0,0,68,now()-interval '1 minute');
  item:=public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100);
  if jsonb_array_length(item)<>1 or item->0->>'source'<>'terminal' then raise exception 'actual HTTP200 excluded';end if;
  select checked_at into stamp from public.catalog_file_reputation;
  insert into public.qa_vt_metadata_rechecks(candidate_id,run_id,sha256,profile_sha256,state,last_http_status,malicious,suspicious,total_engines,analyzed_at,checked_at,reservation_id)
  select candidate,'123',sha256,repeat('B',64),'resolved',200,malicious,suspicious,total_engines,analyzed_at,checked_at,request from public.catalog_file_reputation;
  item:=public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100);
  if jsonb_array_length(item)<>1 or item->0->>'source'<>'metadata' then raise exception 'metadata deduplication failed';end if;
  delete from public.qa_vt_metadata_rechecks;
  -- Every mutation below must exclude the otherwise qualified terminal proof.
  update public.catalog_file_reputation set checked_at=stamp+interval '1 microsecond';
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'overwritten cache accepted';end if;
  update public.catalog_file_reputation set checked_at=stamp,engine_count_version=1;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'v1 accepted';end if;
  update public.catalog_file_reputation set engine_count_version=2,total_engines=null;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'missing engines accepted';end if;
  update public.catalog_file_reputation set total_engines=68,malicious=1;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'positive accepted';end if;
  update public.catalog_file_reputation set malicious=0;
  update public.catalog_file_reputation set retry_after=now()-interval '1 second';
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'expired cache accepted';end if;
  update public.catalog_file_reputation set retry_after=now()+interval '1 day';
  update public.qa_vt_requests set operation='analysis_lookup';
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'unqualified analysis accepted';end if;
  update public.qa_vt_requests set operation='hash_lookup',recheck_lease=request;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'recheck lease accepted';end if;
  update public.qa_vt_requests set recheck_lease=null,reserved_at=now()-interval '2 hours';
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'pre-lifecycle request accepted';end if;
  update public.qa_vt_requests set reserved_at=now()-interval '1 second';
  update public.qa_vt_submission_intents set github_run_id='124';
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only',100)<>'[]'::jsonb then raise exception 'wrong run accepted';end if;
  begin perform public.list_qa_vt_resolved_record_refreshes('wrong',100);raise exception 'wrong secret accepted';exception when others then if sqlerrm='wrong secret accepted' then raise;end if;end;
  if has_function_privilege('authenticated','public.list_qa_vt_resolved_record_refreshes(text,integer)','EXECUTE') then raise exception 'authenticated grant';end if;
end;
$$;
rollback;
