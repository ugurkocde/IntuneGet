-- Synthetic disposable PG17 contract. Never execute against production.
begin;
truncate public.qa_vt_upload_url_recovery_grants,public.qa_vt_requests,
  public.qa_vt_metadata_rechecks,public.qa_vt_submission_intents;
delete from public.qa_candidates;
delete from public.catalog_file_reputation;
update public.qa_vt_request_budget set blocked_until=null;
update public.qa_vt_claim_lane set last_lane='public';
insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
  package_profile_sha256,test_level,status,phase,finished_at,dispatched_at,attempts,enqueued_at,installer_url)
values('40000000-0000-4000-8000-000000000001','Fixture.PostAnalysis','1','x64','99101',repeat('c',64),
  repeat('B',64),'psadt-package','error','publishing',now()-interval '3 hours',
  now()-interval '4 hours',1,now()-interval '5 hours','https://example.invalid/post-analysis');
insert into public.qa_vt_submission_intents(sha256,candidate_id,winget_id,version,architecture,
  manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at,dispatch_started_at,
  dispatch_attempt,profile_sha256,github_run_id,upload_url_reserved_at,upload_reserved_at,
  analysis_id,analysis_recorded_at,outcome)
select lower(installer_sha256),id,winget_id,version,architecture,installer_url,installer_url,
  'qa-vt-terminal:fixture',now()-interval '2 hours',dispatched_at,attempts,package_profile_sha256,
  github_run_id,now()-interval '91 minutes',now()-interval '90 minutes',
  'synthetic_analysis_id',now()-interval '89 minutes','submitted' from public.qa_candidates;
insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at,
  attempts,last_http_status,preflight_attempts,preflight_completed_at)
select id,lower(installer_sha256),package_profile_sha256,github_run_id,now()-interval '1 hour',
  1,404,1,now()-interval '2 hours' from public.qa_candidates;
-- An earlier 404 has no timestamp matching the later accepted analysis.
insert into public.qa_vt_requests(sha256,operation,reserved_at,candidate_id,response_recorded_at)
values(repeat('c',64),'hash_lookup',now()-interval '2 hours',
  '40000000-0000-4000-8000-000000000001',now()-interval '119 minutes');

do $$
declare cid uuid:='40000000-0000-4000-8000-000000000001';h text:=repeat('c',64);
  rid uuid; hash_rid uuid; item jsonb; stamp timestamptz; recorded timestamptz;
  reserved timestamptz; upload_stamp timestamptz; code integer;
begin
  insert into public.qa_vt_requests(sha256,operation,reserved_at,candidate_id)
    values(h,'analysis_lookup',clock_timestamp()-interval '1 second',cid) returning id into rid;
  select reserved_at into reserved from public.qa_vt_requests where id=rid;
  select analysis_recorded_at,upload_reserved_at into recorded,upload_stamp
    from public.qa_vt_submission_intents where sha256=h;
  foreach code in array array[0,202,404] loop
    perform public.complete_qa_vt_metadata_recheck('local-fixture-only',rid,code);
    if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then
      raise exception 'No-verdict analysis became publication evidence: %',code;end if;
    update public.qa_vt_requests set response_recorded_at=null where id=rid;
  end loop;
  perform public.complete_qa_vt_metadata_recheck('local-fixture-only',rid,200,null,0,0,67,now()-interval '1 minute');
  select checked_at into stamp from public.catalog_file_reputation where sha256=h;
  if not exists(select 1 from public.qa_vt_requests where id=rid and response_recorded_at=stamp)
    or not exists(select 1 from public.qa_vt_metadata_rechecks where candidate_id=cid
      and state='pending' and last_http_status=404) then raise exception 'Writer fixture not analysis-only';end if;
  item:=public.list_qa_vt_resolved_record_refreshes('local-fixture-only');
  if jsonb_array_length(item)<>1 or item->0->>'source'<>'terminal'
    or item->0->>'reservation_id'<>rid::text then raise exception 'Completed analysis publication proof missing';end if;
  -- Competing synthetic proofs exercise stable precedence, not a second call.
  insert into public.qa_vt_requests(sha256,operation,reserved_at,candidate_id,response_recorded_at)
    values(h,'hash_lookup',reserved,cid,stamp) returning id into hash_rid;
  item:=public.list_qa_vt_resolved_record_refreshes('local-fixture-only');
  if item->0->>'reservation_id'<>hash_rid::text then raise exception 'Hash proof lost precedence';end if;
  update public.qa_vt_metadata_rechecks m set state='resolved',last_http_status=200,
    malicious=r.malicious,suspicious=r.suspicious,total_engines=r.total_engines,
    analyzed_at=r.analyzed_at,checked_at=r.checked_at
    from public.catalog_file_reputation r where m.candidate_id=cid and r.sha256=h;
  item:=public.list_qa_vt_resolved_record_refreshes('local-fixture-only');
  if item->0->>'source'<>'metadata' then raise exception 'Metadata lost precedence';end if;
  update public.qa_vt_metadata_rechecks set state='pending',last_http_status=404,checked_at=null where candidate_id=cid;
  delete from public.qa_vt_requests where id=hash_rid;

  update public.qa_vt_requests set candidate_id=null where id=rid;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Wrong candidate accepted';end if;
  update public.qa_vt_requests set candidate_id=cid,reserved_at=now()-interval '4 hours' where id=rid;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Pre-lifecycle proof accepted';end if;
  update public.qa_vt_requests set reserved_at=recorded where id=rid;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Pre-analysis proof accepted';end if;
  update public.qa_vt_requests set reserved_at=reserved,recheck_lease=rid where id=rid;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Hold lease accepted';end if;
  update public.qa_vt_requests set recheck_lease=null,metadata_candidate_id=cid where id=rid;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Metadata reservation accepted';end if;
  update public.qa_vt_requests set metadata_candidate_id=null,response_recorded_at=null where id=rid;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Unrecorded response accepted';end if;
  update public.qa_vt_requests set response_recorded_at=stamp where id=rid;
  update public.qa_vt_submission_intents set outcome='ambiguous' where sha256=h;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Wrong outcome accepted';end if;
  update public.qa_vt_submission_intents set outcome='submitted',github_run_id='99102' where sha256=h;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Wrong run accepted';end if;
  update public.qa_vt_submission_intents set github_run_id='99101',profile_sha256=repeat('A',64) where sha256=h;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Wrong profile accepted';end if;
  update public.qa_vt_submission_intents set profile_sha256=repeat('B',64),upload_reserved_at=null where sha256=h;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'No upload accepted';end if;
  update public.qa_vt_submission_intents set upload_reserved_at=upload_stamp where sha256=h;
  update public.catalog_file_reputation set analyzed_at=upload_stamp-interval '6 minutes' where sha256=h;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Pre-upload scan accepted';end if;
  update public.catalog_file_reputation set analyzed_at=now()-interval '1 minute',malicious=1,total_engines=71 where sha256=h;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Positive accepted';end if;
  update public.catalog_file_reputation set malicious=0,suspicious=1 where sha256=h;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Suspicious accepted';end if;
  update public.catalog_file_reputation set suspicious=0,total_engines=67,checked_at=stamp+interval '1 microsecond' where sha256=h;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Replaced cache accepted';end if;
  update public.catalog_file_reputation set checked_at=stamp,retry_after=now()-interval '1 second' where sha256=h;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Expired cache accepted';end if;
  update public.catalog_file_reputation set retry_after=now()+interval '1 day',checked_at=now()-interval '8 days' where sha256=h;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Stale cache accepted';end if;
  update public.catalog_file_reputation set checked_at=stamp where sha256=h;
  update public.qa_candidates set status='passed' where id=cid;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Passed candidate accepted';end if;
  update public.qa_candidates set status='error',phase='testing' where id=cid;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Non-publishing candidate accepted';end if;
  update public.qa_candidates set phase='publishing',github_run_id='99102' where id=cid;
  if public.list_qa_vt_resolved_record_refreshes('local-fixture-only')<>'[]'::jsonb then raise exception 'Broken terminal identity accepted';end if;
  update public.qa_candidates set github_run_id='99101' where id=cid;
  if jsonb_array_length(public.list_qa_vt_resolved_record_refreshes('local-fixture-only'))<>1 then raise exception 'Fixture did not recover';end if;
end;
$$;
rollback;
