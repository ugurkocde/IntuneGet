-- Disposable fixture only. Never execute against production.
begin;
do $$
declare cid uuid := '80100000-0000-4000-8000-000000000001';
  canonical text := '{"app":{"wingetId":"Fixture.App","version":"1.0","architecture":"x64"},"toolchain":{"packagerCommit":"dddddddddddddddddddddddddddddddddddddddd"},"installer":{"sha256":"EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE","packageDependencies":[{"order":1,"packageIdentifier":"Microsoft.VCRedist.2015+.x64","version":"14.51.36247.0","architecture":"x64","sha256":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]}}';
  profile text; content text:=repeat('C',64); r jsonb; bad jsonb; preimage text;
  claim jsonb; field text; saved jsonb; before_count integer;
  cid2 uuid:='80100000-0000-4000-8000-000000000002'; r2 jsonb;
begin
  if exists(select 1 from public.qa_candidates where id=cid) then raise exception 'Fixture identity unavailable';end if;
  profile := upper(encode(extensions.digest(canonical,'sha256'),'hex'));
  insert into public.qa_candidates(id,winget_id,version,architecture,status,test_level,github_run_id,
    installer_sha256,package_profile_sha256,test_config,dispatched_at,enqueued_at,attempts)
  values(cid,'Fixture.App','1.0','x64','running','psadt-package','123',repeat('E',64),profile,
    jsonb_build_object('packageProfileCanonicalJson',canonical),now()-interval '1 hour',now()-interval '2 hours',1);
  insert into public.packaging_jobs(id,qa_candidate_id,status) values(gen_random_uuid(),cid,'awaiting_qa');
  -- A literal compact preimage independently specifies the wire format.
  preimage := '{"schemaVersion":1,"status":"recorded","candidateId":"80100000-0000-4000-8000-000000000001","executionContext":"LocalSystem","testId":"github-123-1","runId":"123","runAttempt":1,"sourceCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","packageProfileSha256":"'||profile||'","packageContentSha256":"'||content||'","packagerCommit":"dddddddddddddddddddddddddddddddddddddddd","entries":[{"order":1,"packageIdentifier":"Microsoft.VCRedist.2015+.x64","version":"14.51.36247.0","architecture":"x64","sha256":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","exitCode":0,"classification":"installed"}]}';
  r := preimage::jsonb || jsonb_build_object('sha256',upper(encode(extensions.digest(preimage,'sha256'),'hex')));

  update public.qa_candidates set test_config=test_config||jsonb_build_object('packageDependencies',jsonb_build_array(jsonb_build_object(
    'order',1,'packageIdentifier','Microsoft.VCRedist.2015+.x64','version','14.51.36247.0','architecture','x64',
    'installerSha256',repeat('A',64),'installerUrl','https://download.microsoft.com/fixture.exe'))) where id=cid;
  if not public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,r,'Passed') then raise exception 'Receipt rejected';end if;
  -- One DO block has one statement timestamp; advance fixture chronology only.
  update public.qa_dependency_execution_receipts set recorded_at=now()-interval '2 seconds' where candidate_id=cid;
  update public.qa_candidates set status='error',phase='publishing',finished_at=now()-interval '1 second' where id=cid;
  saved:=(select test_config from public.qa_candidates where id=cid);
  -- Each invalid state must admit nothing. Restore the exact stored tuple.
  update public.qa_dependency_execution_receipts set lifecycle_outcome='Failed' where candidate_id=cid;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>0 then raise exception 'Failed receipt admitted';end if;
  update public.qa_dependency_execution_receipts set lifecycle_outcome='Passed' where candidate_id=cid;
  update public.qa_candidates set github_run_id='124' where id=cid;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>0 then raise exception 'Old run admitted';end if;
  update public.qa_candidates set github_run_id='123',package_profile_sha256=repeat('F',64) where id=cid;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>0 then raise exception 'Changed profile admitted';end if;
  update public.qa_candidates set package_profile_sha256=profile,test_config=jsonb_set(saved,'{packageDependencies,0,installerUrl}','"http://download.microsoft.com/fixture.exe"') where id=cid;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>0 then raise exception 'HTTP source admitted';end if;
  update public.qa_candidates set test_config=saved,finished_at=now()-interval '15 days' where id=cid;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>0 then raise exception 'Old terminal admitted';end if;
  update public.qa_candidates set finished_at=now()-interval '1 second',status='superseded' where id=cid;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>0 then raise exception 'Superseded admitted';end if;
  update public.qa_candidates set status='error' where id=cid;
  update public.qa_dependency_execution_receipts set receipt=jsonb_set(receipt,'{entries,0,classification}','"unconfirmed"') where candidate_id=cid;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>0 then raise exception 'Unconfirmed admitted';end if;
  update public.qa_dependency_execution_receipts set receipt=r where candidate_id=cid;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>1 then raise exception 'Installed current demand rejected';end if;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>0 then raise exception 'Demand duplicated';end if;
  insert into public.qa_candidates(id,winget_id,version,architecture,status,test_level,github_run_id,installer_sha256,
    package_profile_sha256,test_config,dispatched_at,enqueued_at,attempts)
    select cid2,winget_id,version,architecture,'running',test_level,'456',installer_sha256,
      package_profile_sha256,test_config,dispatched_at,enqueued_at,attempts from public.qa_candidates where id=cid;
  insert into public.packaging_jobs(id,qa_candidate_id,status) values(gen_random_uuid(),cid2,'awaiting_qa');
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>0 then raise exception 'No receipt admitted';end if;
  preimage:=replace(replace(preimage,cid::text,cid2::text),'123','456');
  r2:=preimage::jsonb||jsonb_build_object('sha256',upper(encode(extensions.digest(preimage,'sha256'),'hex')));
  if not public.record_qa_dependency_receipt('local-fixture-only',cid2,'456',1,content,r2,'Passed') then raise exception 'Second receipt rejected';end if;
  update public.qa_dependency_execution_receipts set recorded_at=now()-interval '2 seconds' where candidate_id=cid2;
  update public.qa_candidates set status='error',phase='publishing',finished_at=now()-interval '1 second' where id=cid2;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>1 then raise exception 'Shared demand rejected';end if;
  if (select count(*) from public.qa_vt_dependency_demands where sha256=repeat('a',64))<>2
    or (select count(*) from public.qa_vt_dependency_rechecks where sha256=repeat('a',64))<>1 then raise exception 'Hash dedup failed';end if;
  if public.qa_vt_dependency_coverage(cid) then raise exception 'Missing verdict covered';end if;
  select count(*) into before_count from public.qa_vt_requests;
  update public.qa_vt_request_budget set blocked_until=clock_timestamp()+interval '1 hour' where id=true;
  claim:=public.claim_qa_vt_dependency_recheck('local-fixture-only');
  if claim->>'reservationId' is not null or (select count(*) from public.qa_vt_requests)<>before_count then raise exception 'Global backoff ignored';end if;
  update public.qa_vt_request_budget set blocked_until=null;
  update public.qa_vt_dependency_rechecks set retry_at=clock_timestamp()-interval '1 second';
  claim:=public.claim_qa_vt_dependency_recheck('local-fixture-only');
  if claim->>'reservationId' is null then raise exception 'Lookup not reserved';end if;
  if public.claim_qa_vt_dependency_recheck('local-fixture-only')->>'reservationId' is not null then raise exception 'Duplicate lease';end if;
  begin
    perform public.complete_qa_vt_dependency_recheck('local-fixture-only',(claim->>'lease')::uuid,200,null,0,0,null,now()-interval '1 hour');
    raise exception 'Uncovered result accepted';
  exception when others then if sqlerrm='Uncovered result accepted' then raise;end if;end;
  perform public.complete_qa_vt_dependency_recheck('local-fixture-only',(claim->>'lease')::uuid,200,null,0,0,70,now()-interval '1 hour');
  update public.catalog_file_reputation set checked_at=now() where sha256=repeat('a',64);
  if not public.qa_vt_dependency_coverage(cid) then raise exception 'Covered clean result rejected';end if;
  if (select engine_count_version from public.catalog_file_reputation where sha256=repeat('a',64))<>2 then raise exception 'Coverage version missing';end if;
  update public.qa_vt_dependency_rechecks set state='pending',retry_at=now()-interval '1 second';
  select count(*) into before_count from public.qa_vt_requests;
  claim:=public.claim_qa_vt_dependency_recheck('local-fixture-only');
  if claim->>'cached'<>'true' or (select count(*) from public.qa_vt_requests)<>before_count then raise exception 'Fresh cache spent quota';end if;
  update public.catalog_file_reputation set engine_count_version=1 where sha256=repeat('a',64);
  if public.qa_vt_dependency_coverage(cid) then raise exception 'Legacy verdict covered';end if;
  update public.qa_vt_dependency_rechecks set state='pending',retry_at=now()-interval '1 second';
  claim:=public.claim_qa_vt_dependency_recheck('local-fixture-only');
  perform public.complete_qa_vt_dependency_recheck('local-fixture-only',(claim->>'lease')::uuid,404);
  if (select state from public.qa_vt_dependency_rechecks where sha256=repeat('a',64))<>'not_found' or public.qa_vt_dependency_coverage(cid) then raise exception '404 did not hold';end if;
  if public.claim_qa_vt_dependency_recheck('local-fixture-only')->>'reservationId' is not null then raise exception '404 retried or uploaded';end if;
  -- Local fixture reactivates only to exercise positive verdicts; production
  -- admission never reactivates a terminal not_found or resolved hash.
  for before_count in 1..2 loop
    update public.qa_vt_dependency_rechecks set state='pending',retry_at=now()-interval '1 second';
    claim:=public.claim_qa_vt_dependency_recheck('local-fixture-only');
    perform public.complete_qa_vt_dependency_recheck('local-fixture-only',(claim->>'lease')::uuid,200,null,before_count,0,70,now());
    update public.catalog_file_reputation set checked_at=now(),retry_after=now()-interval '1 second' where sha256=repeat('a',64);
    if public.qa_vt_dependency_coverage(cid) or (select malicious_verdicts from public.qa_installer_security_holds where sha256=repeat('a',64))<>before_count
      then raise exception 'Positive verdict failed to hold exact dependency';end if;
  end loop;
  update public.qa_vt_dependency_rechecks set state='pending',attempts=6,retry_at=now()-interval '1 second';
  if public.claim_qa_vt_dependency_recheck('local-fixture-only')->>'reservationId' is not null then raise exception 'Six attempt cap ignored';end if;
  if (select state from public.qa_vt_dependency_rechecks where sha256=repeat('a',64))<>'escalated' then raise exception 'Exhausted demand not escalated';end if;
  if exists(select 1 from public.qa_vt_submission_intents where sha256=repeat('a',64)) then raise exception 'Lookup admitted upload';end if;
end;
$$;
rollback;
