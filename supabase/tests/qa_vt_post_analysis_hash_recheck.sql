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
insert into public.qa_vt_requests(sha256,operation,reserved_at,candidate_id,response_recorded_at)
select repeat('c',64),'analysis_lookup',now()-make_interval(mins=>n),
  '40000000-0000-4000-8000-000000000001',now()-make_interval(mins=>n)
from unnest(array[80,60,40]) n;

-- Post-migration assertions
do $$
declare cid uuid:='40000000-0000-4000-8000-000000000001';h text:=repeat('c',64);
  claim jsonb;other jsonb;rid uuid;response_status integer:=current_setting('qa.test_http_status')::integer;
begin
  if not public.qa_vt_post_analysis_hash_recheck_ready(cid,h,'99101',repeat('B',64),now()) then
    raise exception 'Exhausted submitted fixture not ready';end if;
  if public.qa_vt_post_analysis_hash_recheck_ready(cid,h,'wrong',repeat('B',64),now())
    or public.qa_vt_post_analysis_hash_recheck_ready(cid,h,'99101',repeat('A',64),now()) then
    raise exception 'Run or profile mismatch admitted';end if;
  update public.qa_vt_submission_intents set outcome='ambiguous' where sha256=h;
  if public.qa_vt_post_analysis_hash_recheck_ready(cid,h,'99101',repeat('B',64),now()) then
    raise exception 'Non-submitted intent admitted';end if;
  update public.qa_vt_submission_intents set outcome='submitted' where sha256=h;
  delete from public.qa_vt_requests where sha256=h and reserved_at<now()-interval '70 minutes';
  if public.qa_vt_post_analysis_hash_recheck_ready(cid,h,'99101',repeat('B',64),now()) then
    raise exception 'Unexhausted analysis lane admitted';end if;
  insert into public.qa_vt_requests(sha256,operation,reserved_at,candidate_id)
    values(h,'analysis_lookup',now()-interval '5 minutes',cid) returning id into rid;
  if public.qa_vt_post_analysis_hash_recheck_ready(cid,h,'99101',repeat('B',64),now()) then
    raise exception 'Analysis backoff bypassed';end if;
  update public.qa_vt_requests set reserved_at=now()-interval '80 minutes' where id=rid;
  insert into public.qa_installer_security_holds(sha256,malicious_verdicts) values(h,1);
  if public.qa_vt_post_analysis_hash_recheck_ready(cid,h,'99101',repeat('B',64),now()) then
    raise exception 'Positive hold bypassed';end if;
  delete from public.qa_installer_security_holds where sha256=h;
  insert into public.qa_package_blocks(winget_id,version,architecture,installer_sha256,block_code,detail)
    values('Fixture.PostAnalysis','1','x64',h,'fixture','fixture');
  if public.qa_vt_post_analysis_hash_recheck_ready(cid,h,'99101',repeat('B',64),now()) then
    raise exception 'Package block bypassed';end if;
  delete from public.qa_package_blocks where installer_sha256=h;
  insert into public.qa_vt_requests(sha256,operation,reserved_at) values(h,'hash_lookup',now()-interval '1 hour') returning id into rid;
  if public.qa_vt_post_analysis_hash_recheck_ready(cid,h,'99101',repeat('B',64),now()) then
    raise exception 'Post-upload hash lookup repeated';end if;
  delete from public.qa_vt_requests where id=rid;
  update public.qa_candidates set status='passed' where id=cid;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'reservationId' is not null then raise exception 'Passed candidate spent lookup';end if;
  update public.qa_candidates set status='error' where id=cid;
  update public.qa_vt_request_budget set blocked_until=now()+interval '1 hour';
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'reservationId' is not null or (select attempts from public.qa_vt_metadata_rechecks where candidate_id=cid)<>1 then
    raise exception 'Global refusal spent an attempt';end if;
  update public.qa_vt_request_budget set blocked_until=null;
  update public.qa_vt_metadata_rechecks set retry_at=now()-interval '1 minute' where candidate_id=cid;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'candidateId' is distinct from cid::text or claim->>'lease' is null
    or (select attempts from public.qa_vt_metadata_rechecks where candidate_id=cid)<>2
    or (select preflight_attempts from public.qa_vt_metadata_rechecks where candidate_id=cid)<>1 then
    raise exception 'Submitted candidate did not get a normal metadata lease';end if;
  other:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if other->>'reservationId' is not null then raise exception 'Duplicate lease or read';end if;
  if exists(select 1 from public.qa_vt_requests where operation in ('upload_url','upload'))
    or (select count(*) from public.qa_vt_requests where operation='analysis_lookup')<>3 then
    raise exception 'Upload or poll guard changed';end if;
  if response_status=200 then
    perform public.complete_qa_vt_metadata_recheck('local-fixture-only',(claim->>'lease')::uuid,
      200,null,0,0,70,now()-interval '1 minute');
    if not exists(select 1 from public.catalog_file_reputation where sha256=h and status='found'
      and malicious=0 and suspicious=0 and total_engines=70 and engine_count_version=2) then
      raise exception 'Exact file-hash verdict not recorded';end if;
  else
    perform public.complete_qa_vt_metadata_recheck('local-fixture-only',(claim->>'lease')::uuid,
      response_status,case when response_status=429 then now()+interval '2 hours' else null end);
    if exists(select 1 from public.catalog_file_reputation where sha256=h and status='found') then
      raise exception 'Incomplete lookup became a verdict';end if;
    if response_status=404 then
      update public.qa_vt_metadata_rechecks set retry_at=now()-interval '1 minute' where candidate_id=cid;
      other:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
      if other->>'reservationId' is not null then raise exception '404 did not park once-only route';end if;
    else
      if (select attempts from public.qa_vt_metadata_rechecks where candidate_id=cid)<>2
        or (select last_http_status from public.qa_vt_metadata_rechecks where candidate_id=cid)<>response_status then
        raise exception 'Existing temporary-error retry state changed';end if;
    end if;
  end if;
  if exists(select 1 from unnest(array['anon','authenticated','service_role']) r
    where has_function_privilege(r,'public.qa_vt_post_analysis_hash_recheck_ready(uuid,text,text,text,timestamptz)','execute')) then
    raise exception 'Readiness helper exposed to API roles';end if;
end $$;
rollback;
