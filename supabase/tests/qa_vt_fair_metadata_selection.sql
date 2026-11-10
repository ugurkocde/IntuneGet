-- Disposable fixture only. Never run against production.
begin;
truncate public.qa_vt_requests,public.qa_vt_metadata_rechecks,public.qa_vt_submission_intents;
delete from public.qa_candidates;
delete from public.catalog_file_reputation;
update public.qa_vt_request_budget set blocked_until=null;
do $$
declare first_claim jsonb; second_claim jsonb; public_claim jsonb; metadata_claim jsonb;
begin
  insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
    package_profile_sha256,test_level,status,phase,finished_at,dispatched_at,attempts,enqueued_at,installer_url)
  select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Fixture.Fair'||n,'1','x64',n::text,
    lpad(to_hex(n),64,'a'),repeat('B',64),'psadt-package','error','publishing',now()-interval '1 hour',
    now()-interval '2 hours',1,now()-interval '3 hours','https://example.invalid/installer'
  from generate_series(1,7) n;
  insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at,last_http_status)
  select id,lower(installer_sha256),package_profile_sha256,github_run_id,now()-interval '1 minute',null
  from public.qa_candidates where winget_id<>'Fixture.Fair7';
  insert into public.qa_vt_submission_intents(sha256,candidate_id,winget_id,version,architecture,
    manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at,dispatch_started_at,
    dispatch_attempt,profile_sha256,github_run_id)
  select lower(installer_sha256),id,winget_id,version,architecture,installer_url,installer_url,
    'qa-vt-terminal:fixture-only',statement_timestamp(),dispatched_at,attempts,package_profile_sha256,github_run_id
  from public.qa_candidates where winget_id='Fixture.Fair7';
  if not public.qa_vt_submission_admissible(lpad('7',64,'a')) then raise exception 'Fixture intent not admissible';end if;
  first_claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  second_claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  public_claim:=case when first_claim ? 'nextSubmission' then first_claim else second_claim end;
  metadata_claim:=case when first_claim ? 'reservationId' then first_claim else second_claim end;
  if not (public_claim ? 'nextSubmission') then raise exception 'Public submission starved behind metadata backlog';end if;
  if metadata_claim->>'reservationId' is null then raise exception 'Metadata starved behind public submission';end if;
  if public_claim->'nextSubmission'->>'candidateId'<>'10000000-0000-4000-8000-000000000007'
    or public_claim->'nextSubmission'->>'sha256'<>lpad('7',64,'a')
    or public_claim->'nextSubmission'->>'installerUrl'<>'https://example.invalid/installer' then
    raise exception 'Public exact tuple changed';end if;
  if (select count(*) from public.qa_vt_requests)<>1 then raise exception 'Public offer spent quota';end if;
  -- An offered public operation that never reserves must still yield its next turn.
  first_claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  second_claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if not(first_claim ? 'nextSubmission') or second_claim->>'reservationId' is null then
    raise exception 'Unconsumed public offer prevented alternation';end if;
  if (select count(*) from public.qa_vt_requests)<>2 then raise exception 'Offers fabricated quota';end if;
  if exists(select 1 from public.qa_vt_submission_intents where upload_reserved_at is not null
    or hash_not_found_at is not null or analysis_recorded_at is not null) then raise exception 'Selection fabricated evidence';end if;
  -- No role exposed to the API can read or pin the fairness cursor.
  if exists(select 1 from unnest(array['anon','authenticated','service_role']) role_name
    where has_table_privilege(role_name,'public.qa_vt_claim_lane','select,insert,update,delete')) then
    raise exception 'Cursor exposed to API roles';end if;
  if not has_function_privilege('anon','public.claim_qa_vt_metadata_recheck(text)','execute')
    or has_function_privilege('authenticated','public.claim_qa_vt_metadata_recheck(text)','execute') then
    raise exception 'Claim ACL changed';end if;
  -- A global deferral never becomes a public offer or a new request.
  update public.qa_vt_request_budget set blocked_until=now()+interval '1 hour';
  first_claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if first_claim ? 'nextSubmission' or first_claim ? 'nextAnalysis'
    or first_claim->>'reservationId' is not null then raise exception 'Global block bypassed';end if;
  if (select count(*) from public.qa_vt_requests)<>2 then raise exception 'Blocked claim spent quota';end if;
  if (select last_lane from public.qa_vt_claim_lane where id=true)<>'metadata' then
    raise exception 'Refused offer flipped cursor';end if;
  update public.qa_vt_request_budget set blocked_until=null;
  -- An already consumed upload is ineligible; metadata gets the idle public turn.
  update public.qa_vt_submission_intents set upload_reserved_at=now();
  first_claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if first_claim ? 'nextSubmission' or first_claim ? 'nextAnalysis'
    or first_claim->>'reservationId' is null then raise exception 'Consumed upload selected or idle lane blocked metadata';end if;
  -- With no eligible metadata the public lane still runs even if metadata is next.
  update public.qa_vt_metadata_rechecks set state='escalated',lease=null,lease_expires_at=null;
  update public.qa_vt_submission_intents set upload_reserved_at=null;
  update public.qa_vt_claim_lane set last_lane='public';
  first_claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if not(first_claim ? 'nextSubmission') then raise exception 'Empty metadata lane blocked public';end if;
  update public.qa_vt_submission_intents set upload_reserved_at=now();
  first_claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if first_claim<>jsonb_build_object('stop','no_eligible_work')
    or (select last_lane from public.qa_vt_claim_lane where id=true)<>'public' then
    raise exception 'Empty claim changed cursor';end if;
  -- Due analyses share the public lane; an offered poll is not provider proof.
  update public.qa_vt_submission_intents set outcome='submitted',analysis_id='fixture-analysis',
    analysis_recorded_at=now()-interval '11 minutes';
  update public.qa_vt_claim_lane set last_lane='metadata';
  first_claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if first_claim->'nextAnalysis'->>'candidateId' is distinct from '10000000-0000-4000-8000-000000000007' then
    raise exception 'Due analysis starved';end if;
  if (select count(*) from public.qa_vt_requests)<>3 then raise exception 'Analysis offer spent quota';end if;
  -- Without metadata, exhausted analysis polling still cannot be offered.
  insert into public.qa_vt_requests(sha256,operation,candidate_id,reserved_at)
  select lpad('7',64,'a'),'analysis_lookup','10000000-0000-4000-8000-000000000007',now()-interval '11 minutes'
  from generate_series(1,3);
  first_claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if first_claim ? 'nextAnalysis' then raise exception 'Analysis polling cap bypassed';end if;

end;
$$;
rollback;
