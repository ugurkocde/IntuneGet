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


insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
 package_profile_sha256,test_level,status,phase,finished_at,dispatched_at,attempts,enqueued_at,installer_url)
values('40000000-0000-4000-8000-000000000002','Fixture.Fresh','1','x64','99102',repeat('d',64),
 repeat('B',64),'psadt-package','error','publishing',now()-interval '3 hours',
 now()-interval '4 hours',1,now()-interval '5 hours','https://example.invalid/fresh');
insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at)
values('40000000-0000-4000-8000-000000000002',repeat('d',64),repeat('B',64),'99102',now()-interval '1 hour');
delete from public.packaging_jobs;
-- Customer ordering stays first, including fresh customer demand.
insert into public.packaging_jobs(id,qa_candidate_id,status)
select '50000000-0000-4000-8000-000000000001',
 case when current_setting('qa.priority_case')='customer_ready' then '40000000-0000-4000-8000-000000000001'::uuid
 else '40000000-0000-4000-8000-000000000002'::uuid end,'awaiting_qa'
where current_setting('qa.priority_case') in ('customer_ready','customer_fresh');
-- An unelapsed analysis backoff must never receive the priority or a lease.
update public.qa_vt_requests set reserved_at=now()-interval '5 minutes'
where operation='analysis_lookup' and current_setting('qa.priority_case')='backoff';
do $$
declare claim jsonb; expected text;
begin
 expected:=case when current_setting('qa.priority_case') in ('customer_fresh','backoff')
 then '40000000-0000-4000-8000-000000000002' else '40000000-0000-4000-8000-000000000001' end;
 claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
 if claim->>'candidateId' is distinct from expected or claim->>'lease' is null then
   raise exception 'Post-upload priority selected wrong tuple for %',current_setting('qa.priority_case');end if;
 if (select count(*) from public.qa_vt_requests where operation='upload')<>0 then
   raise exception 'Priority caused an upload';end if;
end $$;
rollback;
