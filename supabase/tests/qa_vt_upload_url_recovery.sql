-- Synthetic disposable contract. Never execute against production.
begin;
truncate public.qa_vt_upload_url_recovery_grants,public.qa_vt_requests,
  public.qa_vt_metadata_rechecks,public.qa_vt_submission_intents;
delete from public.qa_candidates;
delete from public.catalog_file_reputation;
update public.qa_vt_request_budget set blocked_until=null;
insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
  package_profile_sha256,test_level,status,phase,finished_at,dispatched_at,attempts,enqueued_at,installer_url)
select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Fixture.URLRecovery'||n,'1','x64',n::text,
  lpad(to_hex(n),64,'d'),repeat('B',64),'psadt-package','error','publishing',now()-interval '1 hour',
  now()-interval '2 hours',1,now()-interval '3 hours','https://example.invalid/installer'
from generate_series(1,6) n;
insert into public.qa_vt_requests(sha256,operation,reserved_at,candidate_id,response_recorded_at)
select lower(installer_sha256),'hash_lookup',now()-interval '4 minutes',id,now()-interval '4 minutes'
from public.qa_candidates;
insert into public.qa_vt_requests(sha256,operation,reserved_at,candidate_id)
select lower(installer_sha256),'upload_url',now()-interval '3 minutes',id from public.qa_candidates;
insert into public.qa_vt_submission_intents(sha256,candidate_id,winget_id,version,architecture,
  manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at,dispatch_started_at,
  dispatch_attempt,profile_sha256,github_run_id,upload_url_reserved_at,hash_lookup_reservation_id,hash_not_found_at)
select lower(c.installer_sha256),c.id,c.winget_id,c.version,c.architecture,c.installer_url,c.installer_url,
  'qa-vt-terminal:fixture',now()-interval '5 minutes',c.dispatched_at,c.attempts,c.package_profile_sha256,c.github_run_id,
  now()-interval '3 minutes',r.id,r.reserved_at from public.qa_candidates c
join public.qa_vt_requests r on r.candidate_id=c.id and r.operation='hash_lookup';
insert into public.qa_vt_upload_url_recovery_grants(sha256,candidate_id,run_id,profile_sha256,
  original_upload_url_request_id,original_upload_url_reserved_at,reason,granted_at)
select i.sha256,i.candidate_id,i.github_run_id,i.profile_sha256,r.id,i.upload_url_reserved_at,'preupload_response_recovery',now()-interval '1 minute'
from public.qa_vt_submission_intents i join public.qa_vt_requests r on r.candidate_id=i.candidate_id and r.operation='upload_url'
where i.github_run_id<>'6';
-- Recovery assertions
do $$
declare cid uuid:='30000000-0000-4000-8000-000000000001';h text:=lpad('1',64,'d');r jsonb;u jsonb;claim jsonb;
begin
  if not public.qa_vt_upload_url_recovery_ready(cid,h) then raise exception 'Recovery fixture not ready';end if;
  if public.qa_vt_upload_url_recovery_ready('30000000-0000-4000-8000-000000000006',lpad('6',64,'d')) then raise exception 'Sixth tuple admitted';end if;
  update public.qa_vt_request_budget set blocked_until=now()+interval '1 hour';
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim ? 'nextSubmission' then raise exception 'Global deferral bypassed';end if;
  update public.qa_vt_request_budget set blocked_until=null;
  update public.qa_vt_submission_intents set verified_at=now()-interval '7 hours' where sha256=h;
  if public.qa_vt_upload_url_recovery_ready(cid,h) then raise exception 'Expired preflight accepted';end if;
  update public.qa_vt_submission_intents set verified_at=now()-interval '5 minutes' where sha256=h;
  update public.qa_candidates set package_profile_sha256=repeat('C',64) where id=cid;
  if public.qa_vt_upload_url_recovery_ready(cid,h) then raise exception 'Changed identity accepted';end if;
  update public.qa_candidates set package_profile_sha256=repeat('B',64) where id=cid;
  insert into public.qa_installer_security_holds(sha256,malicious_verdicts) values(h,1);
  if public.qa_vt_upload_url_recovery_ready(cid,h) then raise exception 'Positive hold accepted';end if;
  delete from public.qa_installer_security_holds where sha256=h;
  insert into public.catalog_file_reputation(sha256,status) values(h,'found');
  if public.qa_vt_upload_url_recovery_ready(cid,h) then raise exception 'Known file accepted for upload';end if;
  delete from public.catalog_file_reputation where sha256=h;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->'nextSubmission'->>'candidateId' is distinct from cid::text then raise exception 'Recovery not offered';end if;
  r:=public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'hash_lookup');
  if r->>'reservationId' is null then raise exception 'Fresh recovery lookup refused';end if;
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'hash_lookup');
    raise exception 'TEST third lookup accepted';
  exception when others then if sqlerrm<>'QA VirusTotal candidate lookup budget exhausted' then raise;end if;end;
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'upload_url');
    raise exception 'TEST old404 accepted';
  exception when others then if sqlerrm<>'Public installer URL recovery proof unavailable' then raise;end if;end;
  perform public.record_qa_vt_submission_analysis('local-fixture-only',cid,h,r->>'reservationId','not_found');
  update public.qa_vt_request_budget set blocked_until=now()+interval '1 hour';
  u:=public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'upload_url');
  if u->>'reservationId' is not null or exists(select 1 from public.qa_vt_upload_url_recovery_grants where consumed_at is not null) then raise exception 'Quota stop consumed grant';end if;
  update public.qa_vt_request_budget set blocked_until=null;
  u:=public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'upload_url');
  if u->>'reservationId' is null or not exists(select 1 from public.qa_vt_upload_url_recovery_grants
    where sha256=h and consumed_request_id=(u->>'reservationId')::uuid and consumed_at is not null) then raise exception 'Recovery not consumed atomically';end if;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim ? 'nextSubmission' then raise exception 'Stalled canary burned another grant';end if;
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'upload_url');
    raise exception 'TEST second recovery URL accepted';
  exception when others then if sqlerrm<>'Public installer URL recovery proof unavailable' then raise;end if;end;
  u:=public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'upload');
  if u->>'reservationId' is null then raise exception 'Actual upload not reserved';end if;
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'upload');
    raise exception 'TEST repeated actual upload accepted';
  exception when others then if sqlerrm<>'Public installer submission already reserved or stale' then raise;end if;end;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if not(claim ? 'nextSubmission') then raise exception 'Successful canary blocked remaining grants';end if;
  if (select count(*) from public.qa_vt_requests where sha256=h and operation='upload_url')<>2
    or (select count(*) from public.qa_vt_requests where sha256=h and operation='upload')<>1 then raise exception 'Once-only counts violated';end if;
  if exists(select 1 from unnest(array['anon','authenticated','service_role']) role_name
    where has_table_privilege(role_name,'public.qa_vt_upload_url_recovery_grants','select,insert,update,delete')
      or has_function_privilege(role_name,'public.qa_vt_upload_url_recovery_ready(uuid,text)','execute')) then raise exception 'Recovery grants exposed';end if;
end;
$$;
rollback;
