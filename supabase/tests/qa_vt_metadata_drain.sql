-- Disposable fixture only. Never run against production.
begin;
truncate public.qa_vt_requests,public.qa_vt_metadata_rechecks,public.qa_vt_submission_intents;
delete from public.qa_candidates;
delete from public.catalog_file_reputation;
update public.qa_vt_request_budget set blocked_until=null;
do $$
declare claim jsonb; cid uuid:='20000000-0000-4000-8000-000000000001';
begin
  insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
    package_profile_sha256,test_level,status,phase,finished_at,dispatched_at,attempts,enqueued_at,installer_url)
  values(cid,'Fixture.Drain','1','x64','9001',repeat('c',64),repeat('B',64),'psadt-package',
    'error','publishing',now()-interval '1 hour',now()-interval '2 hours',1,now()-interval '3 hours',
    'https://example.invalid/installer');
  insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at,
    last_http_status,preflight_completed_at)
  values(cid,repeat('c',64),repeat('B',64),'9001',now()-interval '1 minute',404,now()-interval '1 hour');
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'reservationId' is not null or exists(select 1 from public.qa_vt_requests) then
    raise exception 'Completed 404 preflight repeated a provider lookup';end if;
  if not exists(select 1 from public.qa_vt_metadata_rechecks where candidate_id=cid and state='pending'
    and attempts=0 and preflight_completed_at is not null) then raise exception 'Completed preflight replayed or relabelled';end if;
  -- An eligible genuine404 offers its one preflight, without a provider reservation.
  update public.qa_vt_metadata_rechecks set preflight_completed_at=null;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->'nextPreflight'->>'candidateId' is distinct from cid::text
    or exists(select 1 from public.qa_vt_requests) then raise exception '404 did not route to preflight';end if;
  -- A used/expired preflight never falls back to another hash lookup.
  update public.qa_vt_metadata_rechecks set preflight_lease=null,preflight_lease_expires_at=null,preflight_attempts=2;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'reservationId' is not null then raise exception 'Exhausted preflight repeated lookup';end if;
  update public.qa_vt_metadata_rechecks set preflight_attempts=0;
  update public.qa_candidates set winget_id='Custom.Drain' where id=cid;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim ? 'nextPreflight' or claim->>'reservationId' is not null then
    raise exception 'Nonpublic404 repeated lookup or bypassed source guard';end if;
  update public.qa_candidates set winget_id='Fixture.Drain' where id=cid;
  -- Already-passed tuples spend no quota, including with no cache.
  update public.qa_candidates set status='passed' where id=cid;
  update public.qa_vt_metadata_rechecks set last_http_status=null,preflight_attempts=0;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'reservationId' is not null then raise exception 'Passed tuple consumed quota';end if;
  -- Truthful fresh cached evidence remains usable without HTTP even for passed/404 rows.
  insert into public.catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,
    engine_count_version,analyzed_at,checked_at,retry_after)
  values(repeat('c',64),'found',0,0,70,2,now()-interval '1 hour',now()-interval '1 hour',now()+interval '6 days');
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'cached' is distinct from 'true' or exists(select 1 from public.qa_vt_requests)
    or not exists(select 1 from public.qa_vt_metadata_rechecks where candidate_id=cid and state='resolved') then
    raise exception 'Truthful cached resolution lost';end if;
  -- A stale clean or positive found verdict is never a reason to spend a reservation.
  update public.qa_candidates set status='error' where id=cid;
  update public.qa_vt_metadata_rechecks set state='pending';
  update public.catalog_file_reputation set checked_at=now()-interval '8 days',retry_after=now()-interval '1 day';
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'reservationId' is not null then raise exception 'Already found tuple consumed quota';end if;
  delete from public.catalog_file_reputation;
  -- A recent metadata reservation enforces per-hash backoff even after a lease expires.
  insert into public.qa_vt_requests(sha256,operation,metadata_candidate_id,reserved_at)
    values(repeat('c',64),'hash_lookup',cid,now()-interval '20 minutes');
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'reservationId' is not null or (select count(*) from public.qa_vt_requests)<>1 then
    raise exception 'Tuple backoff bypassed';end if;
  update public.qa_vt_requests set reserved_at=now()-interval '61 minutes';
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'candidateId' is distinct from cid::text or claim->>'reservationId' is null then
    raise exception 'Backoff did not expire';end if;
  -- A superseded exact tuple never resumes lookup on a later tick.
  truncate public.qa_vt_requests;
  update public.qa_vt_metadata_rechecks set state='pending',lease=null,lease_expires_at=null;
  insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,
    package_profile_sha256,test_level,status,enqueued_at)
  values('20000000-0000-4000-8000-000000000002','Fixture.Drain','2','x64',repeat('d',64),
    repeat('B',64),'psadt-package','queued',now());
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'reservationId' is not null then raise exception 'Superseded tuple consumed quota';end if;
  -- Old passed metadata cannot displace a newly admitted unresolved publication.
  delete from public.qa_candidates where id='20000000-0000-4000-8000-000000000002';
  update public.qa_candidates set status='passed' where id=cid;
  insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
    package_profile_sha256,test_level,status,phase,finished_at,dispatched_at,attempts,enqueued_at,installer_url)
  values('20000000-0000-4000-8000-000000000003','Fixture.Unresolved','1','x64','9003',repeat('e',64),
    repeat('B',64),'psadt-package','error','publishing',now()-interval '1 hour',now()-interval '2 hours',
    1,now()-interval '3 hours','https://example.invalid/installer');
  insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at,last_http_status)
  values('20000000-0000-4000-8000-000000000003',repeat('e',64),repeat('B',64),'9003',now(),null);
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'candidateId' is distinct from '20000000-0000-4000-8000-000000000003'
    or claim->>'reservationId' is null then raise exception 'Old passed tuple displaced unresolved publication';end if;
end;
$$;
rollback;
