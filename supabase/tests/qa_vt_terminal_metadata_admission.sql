-- Disposable fixture only. Never run this against production.
begin;
truncate public.qa_vt_requests,public.qa_vt_metadata_rechecks,public.qa_vt_submission_intents;
delete from public.qa_candidates;
delete from public.catalog_file_reputation;
update public.qa_vt_request_budget set blocked_until=null;
do $$
<<fixture>>
declare id uuid; claim jsonb; pf jsonb; lease uuid; inserted integer;
begin
  -- Batch covers the whole observed missing-admission cohort, not one app.
  insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
    package_profile_sha256,test_level,status,phase,finished_at,dispatched_at,attempts,enqueued_at,installer_url)
  select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Fixture.App'||n,'1','x64',n::text,
    lpad(to_hex(n),64,'a'),repeat('B',64),'psadt-package','error','publishing',now()-interval '1 hour',
    now()-interval '2 hours',1,now()-interval '3 hours','https://example.invalid/installer'
  from generate_series(1,49) n;
  id:='10000000-0000-4000-8000-000000000049';
  insert into public.packaging_jobs(id,qa_candidate_id,status) values(gen_random_uuid(),id,'awaiting_qa');
  inserted:=public.admit_qa_vt_terminal_metadata_rechecks('local-fixture-only');
  if inserted<>49 then raise exception 'Shared batch admission incomplete';end if;
  if public.admit_qa_vt_terminal_metadata_rechecks('local-fixture-only')<>0 then raise exception 'Admission not idempotent';end if;
  if exists(select 1 from public.qa_vt_metadata_rechecks where last_http_status is not null or attempts<>0)
    or exists(select 1 from public.qa_vt_requests) then raise exception 'Admission fabricated HTTP/quota';end if;
  update public.qa_candidates set winget_id='custom.fixture' where qa_candidates.id=fixture.id;
  if public.qa_vt_terminal_public_source(id) then raise exception 'Custom upload admitted';end if;
  update public.qa_candidates set winget_id='IntuneGet.Curated.fixture' where qa_candidates.id=fixture.id;
  if public.qa_vt_terminal_public_source(id) then raise exception 'Curated upload admitted';end if;
  update public.qa_candidates set winget_id='Fixture.App49' where qa_candidates.id=fixture.id;
  insert into public.catalog_file_reputation(sha256,status) select lower(installer_sha256),'found' from public.qa_candidates where qa_candidates.id=fixture.id;
  if public.qa_vt_terminal_public_source(id) then raise exception 'Known file upload admitted';end if;
  delete from public.catalog_file_reputation;
  insert into public.qa_installer_security_holds(sha256,malicious_verdicts) select lower(installer_sha256),1 from public.qa_candidates where qa_candidates.id=fixture.id;
  if public.qa_vt_terminal_public_source(id) then raise exception 'Positive hold upload admitted';end if;
  delete from public.qa_installer_security_holds where sha256=(select lower(installer_sha256) from public.qa_candidates where qa_candidates.id=fixture.id);
  insert into public.installer_health(cache_key,winget_id,version,architecture,installer_url,expected_sha256,status)
    select 'synthetic-quarantine',winget_id,version,architecture,installer_url,upper(installer_sha256),'quarantined'
    from public.qa_candidates where qa_candidates.id=fixture.id;
  if public.qa_vt_terminal_public_source(id) then raise exception 'Quarantined upload admitted';end if;
  delete from public.installer_health where cache_key='synthetic-quarantine';
  update public.qa_candidates set installer_url='https://127.0.0.1/installer' where qa_candidates.id=fixture.id;
  if public.qa_vt_terminal_public_source(id) then raise exception 'Private address admitted';end if;
  update public.qa_candidates set installer_url='https://example.invalid/installer' where qa_candidates.id=fixture.id;
  insert into public.qa_candidates(id,winget_id,version,architecture,status,enqueued_at,installer_sha256,package_profile_sha256)
    values('20000000-0000-4000-8000-000000000001','Fixture.App49','2','x64','queued',now(),repeat('f',64),repeat('C',64));
  if public.qa_vt_terminal_public_source(id) then raise exception 'Superseded identity admitted';end if;
  delete from public.qa_candidates where qa_candidates.id='20000000-0000-4000-8000-000000000001';
  update public.qa_vt_metadata_rechecks set state='escalated',attempts=6 where candidate_id<>fixture.id;
  perform public.admit_qa_vt_terminal_metadata_rechecks('local-fixture-only');
  if (select count(*) from public.qa_vt_metadata_rechecks where state='escalated' and attempts=6)<>48 then
    raise exception 'Admission reset escalation';end if;
  -- Customer wins even when its retry timestamp is later.
  update public.qa_vt_metadata_rechecks set state='pending',attempts=0,retry_at=now()-interval '1 hour'
    where candidate_id='10000000-0000-4000-8000-000000000001';
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'candidateId'<>fixture.id::text or claim->>'reservationId' is null then raise exception 'Customer not claimed/reserved first';end if;
  perform public.complete_qa_vt_metadata_recheck('local-fixture-only',(claim->>'lease')::uuid,404);
  update public.qa_vt_metadata_rechecks set retry_at=now()-interval '1 second' where candidate_id=fixture.id;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');pf:=claim->'nextPreflight';
  if pf->>'candidateId' is distinct from id::text then raise exception 'Real404 did not reach preflight';end if;
  lease:=(pf->>'preflightLease')::uuid;
  begin
    perform public.complete_qa_vt_metadata_recheck('local-fixture-only',lease,200,null,0,0,60,now());
    raise exception 'Preflight lease accepted as metadata';
  exception when others then if sqlerrm='Preflight lease accepted as metadata' then raise;end if;end;
  update public.qa_vt_metadata_rechecks set preflight_lease_expires_at=now()-interval '1 second' where candidate_id=fixture.id;
  begin
    perform public.record_qa_vt_terminal_preflight('local-fixture-only',lease,id,pf->>'sha256','verified');
    raise exception 'Expired preflight accepted';
  exception when others then if sqlerrm='Expired preflight accepted' then raise;end if;end;
  update public.qa_vt_metadata_rechecks set preflight_lease_expires_at=now()+interval '1 minute' where candidate_id=fixture.id;
  if (public.record_qa_vt_terminal_preflight('local-fixture-only',lease,id,pf->>'sha256','verified')->>'admitted')<>'true' then
    raise exception 'Verified source not admitted';end if;
  if (select attempts from public.qa_vt_metadata_rechecks where candidate_id=fixture.id)<>1
    or (select preflight_attempts from public.qa_vt_metadata_rechecks where candidate_id=fixture.id)<>1 then
    raise exception 'Preflight corrupted lookup attempts';end if;
  if exists(select 1 from public.qa_vt_submission_intents where hash_not_found_at is not null
    or hash_lookup_reservation_id is not null or upload_reserved_at is not null) then
    raise exception 'Metadata404 became upload proof';end if;
  -- A real consumer uses a new HTTP/SQL statement. This DO fixture keeps one
  -- statement timestamp, so align only its synthetic timestamp before probing
  -- the unchanged downstream predicate.
  update public.qa_vt_submission_intents set verified_at=statement_timestamp() where candidate_id=fixture.id;
  claim:=public.reserve_qa_vt_candidate_request('local-fixture-only',id,pf->>'sha256','hash_lookup');
  if claim->>'reservationId' is null then raise exception 'Fresh lookup reservation unavailable';end if;
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',id,pf->>'sha256','upload_url');
    raise exception 'Upload accepted without genuine404';
  exception when others then if sqlerrm='Upload accepted without genuine404' then raise;end if;end;
  perform public.record_qa_vt_submission_analysis('local-fixture-only',id,pf->>'sha256',claim->>'reservationId','not_found');
  -- The shared free ledger limits even this synthetic upload attempt.
  update public.qa_vt_request_budget set blocked_until=now()+interval '1 hour';
  claim:=public.reserve_qa_vt_candidate_request('local-fixture-only',id,pf->>'sha256','upload_url');
  if claim->>'reservationId' is not null then raise exception 'Submission bypassed global quota';end if;
  -- Replays never reset upload flags or refresh the once-consumed preflight.
  update public.qa_vt_submission_intents set upload_reserved_at=now() where candidate_id=fixture.id;
  begin
    perform public.record_qa_vt_terminal_preflight('local-fixture-only',lease,id,pf->>'sha256','verified');
    raise exception 'Consumed preflight replayed';
  exception when others then if sqlerrm='Consumed preflight replayed' then raise;end if;end;
  if not exists(select 1 from public.qa_vt_submission_intents where candidate_id=fixture.id and upload_reserved_at is not null) then
    raise exception 'Replay cleared upload flag';end if;
end;
$$;
rollback;

