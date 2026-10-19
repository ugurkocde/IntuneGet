-- Disposable fixture only. Never execute against production.
begin;
create temporary table qa_dependency_entry_calls(candidate_id uuid);
alter function public.qa_vt_installed_dependency_entries(uuid) rename to qa_vt_installed_dependency_entries_orig;
create function public.qa_vt_installed_dependency_entries(p_candidate_id uuid)
returns table(run_id text,run_attempt integer,profile_sha256 text,sha256 text,package_identifier text,dep_order integer)
language plpgsql volatile set search_path='' as $$
begin
  if not exists(select 1 from public.qa_dependency_execution_receipts r
    join public.qa_candidates c on c.id=r.candidate_id and c.github_run_id=r.run_id
    where c.id=p_candidate_id) then raise exception 'ADMISSION_UNBOUNDED';end if;
  insert into pg_temp.qa_dependency_entry_calls values(p_candidate_id);
  return query select * from public.qa_vt_installed_dependency_entries_orig(p_candidate_id);
end;
$$;
-- Recompile the unchanged admission body against the instrumented validator.
do $$ begin execute pg_get_functiondef('public.admit_qa_vt_dependency_rechecks(text)'::regprocedure);end $$;
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
  -- Two authentic attempts for this run must validate once and select the latest.
  update public.qa_candidates set status='running',finished_at=null where id=cid;
  preimage:=replace(replace(preimage,'"runAttempt":1','"runAttempt":2'),'"testId":"github-123-1"','"testId":"github-123-2"');
  r2:=preimage::jsonb||jsonb_build_object('sha256',upper(encode(extensions.digest(preimage,'sha256'),'hex')));
  if not public.record_qa_dependency_receipt('local-fixture-only',cid,'123',2,content,r2,'Passed') then raise exception 'Second attempt rejected';end if;
  update public.qa_dependency_execution_receipts set recorded_at=now()-interval '2 seconds' where candidate_id=cid;
  update public.qa_candidates set status='error',phase='publishing',finished_at=now()-interval '1 second' where id=cid;
  for before_count in 1..50 loop
    insert into public.qa_candidates(id,winget_id,version,architecture,status,phase,test_level,github_run_id,
      installer_sha256,package_profile_sha256,test_config,dispatched_at,enqueued_at,finished_at,attempts)
    select ('80200000-0000-4000-8000-'||lpad(before_count::text,12,'0'))::uuid,winget_id,version,architecture,status,phase,test_level,
      '9'||before_count::text,installer_sha256,package_profile_sha256,test_config,dispatched_at,enqueued_at,finished_at,attempts
      from public.qa_candidates where id=cid;
    insert into public.packaging_jobs(id,qa_candidate_id,status)
      values(gen_random_uuid(),('80200000-0000-4000-8000-'||lpad(before_count::text,12,'0'))::uuid,'awaiting_qa');
  end loop;
  -- A receipt for a former run must not reach validation for the current run.
  insert into public.qa_candidates(id,winget_id,version,architecture,status,phase,test_level,github_run_id,
    installer_sha256,package_profile_sha256,test_config,dispatched_at,enqueued_at,finished_at,attempts)
    select cid2,winget_id,version,architecture,status,phase,test_level,'456',installer_sha256,package_profile_sha256,
      test_config,dispatched_at,enqueued_at,finished_at,attempts from public.qa_candidates where id=cid;
  insert into public.packaging_jobs(id,qa_candidate_id,status) values(gen_random_uuid(),cid2,'awaiting_qa');
  insert into public.qa_dependency_execution_receipts
    select (jsonb_populate_record(null::public.qa_dependency_execution_receipts,to_jsonb(e)||jsonb_build_object('candidate_id',cid2))).*
    from public.qa_dependency_execution_receipts e where candidate_id=cid and run_attempt=1;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>1 then raise exception 'Current receipt not admitted';end if;
  if (select count(*) from pg_temp.qa_dependency_entry_calls)<>1
    or exists(select 1 from pg_temp.qa_dependency_entry_calls where candidate_id<>cid)
    then raise exception 'Validation escaped current receipt candidates';end if;
  if (select count(*) from public.qa_vt_dependency_demands where candidate_id=cid)<>1
    or not exists(select 1 from public.qa_vt_dependency_demands where candidate_id=cid and run_attempt=2)
    then raise exception 'Latest receipt attempt not selected exactly once';end if;
  delete from public.qa_dependency_execution_receipts;
  truncate pg_temp.qa_dependency_entry_calls;
  if public.admit_qa_vt_dependency_rechecks('local-fixture-only')<>0
    or exists(select 1 from pg_temp.qa_dependency_entry_calls) then raise exception 'Empty receipt set performed validation';end if;
end;
$$;
rollback;
