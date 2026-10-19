-- Disposable fixture only. Never execute against production.
begin;
do $$
declare cid uuid := '79900000-0000-4000-8000-000000000001';
  canonical text := '{"app":{"wingetId":"Fixture.App","version":"1.0","architecture":"x64"},"toolchain":{"packagerCommit":"dddddddddddddddddddddddddddddddddddddddd"},"installer":{"sha256":"EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE","packageDependencies":[{"order":1,"packageIdentifier":"Microsoft.VCRedist.2015+.x64","version":"14.51.36247.0","architecture":"x64","sha256":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]}}';
  profile text; content text:=repeat('C',64); r jsonb; bad jsonb; preimage text;
  accepted boolean; before_rows integer; field text;
begin
  if exists(select 1 from public.qa_candidates where id=cid) then raise exception 'Fixture identity unavailable';end if;
  profile := upper(encode(extensions.digest(canonical,'sha256'),'hex'));
  insert into public.qa_candidates(id,winget_id,version,architecture,status,test_level,github_run_id,
    installer_sha256,package_profile_sha256,test_config,dispatched_at,enqueued_at)
  values(cid,'Fixture.App','1.0','x64','running','psadt-package','123',repeat('E',64),profile,
    jsonb_build_object('packageProfileCanonicalJson',canonical),now()-interval '1 hour',now()-interval '2 hours');
  insert into public.packaging_jobs(id,qa_candidate_id,status) values(gen_random_uuid(),cid,'awaiting_qa');
  -- A literal compact preimage independently specifies the wire format.
  preimage := '{"schemaVersion":1,"status":"recorded","candidateId":"79900000-0000-4000-8000-000000000001","executionContext":"LocalSystem","testId":"github-123-1","runId":"123","runAttempt":1,"sourceCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","packageProfileSha256":"'||profile||'","packageContentSha256":"'||content||'","packagerCommit":"dddddddddddddddddddddddddddddddddddddddd","entries":[{"order":1,"packageIdentifier":"Microsoft.VCRedist.2015+.x64","version":"14.51.36247.0","architecture":"x64","sha256":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","exitCode":0,"classification":"installed"}]}';
  r := preimage::jsonb || jsonb_build_object('sha256',upper(encode(extensions.digest(preimage,'sha256'),'hex')));
  select count(*) into before_rows from public.catalog_file_reputation;
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'124',1,content,r,'Passed') then raise exception 'Another run accepted';end if;
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',2,content,r,'Passed') then raise exception 'Another attempt accepted';end if;
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,repeat('F',64),r,'Passed') then raise exception 'Another archive accepted';end if;
  foreach field in array array['sourceCommit','sha256','candidateId','runId','packageProfileSha256','packageContentSha256'] loop
    bad:=jsonb_set(r,array[field],'null'::jsonb);
    if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,bad,'Passed') then raise exception 'Null binding accepted %',field;end if;
  end loop;
  foreach field in array array['packageIdentifier','version','architecture','sha256','classification'] loop
    bad:=jsonb_set(r,array['entries','0',field],'null'::jsonb);
    if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,bad,'Passed') then raise exception 'Null entry accepted %',field;end if;
  end loop;
  bad:=r||jsonb_build_object('rawLog','private');
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,bad,'Passed') then raise exception 'Unexpected field accepted';end if;
  bad:=jsonb_set(r,'{entries,0,exitCode}','1638');
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,bad,'Passed') then raise exception 'No-op installed claim accepted';end if;
  bad:=jsonb_set(r,'{entries,0,sha256}',to_jsonb(repeat('E',64)));
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,bad,'Passed') then raise exception 'Main hash accepted';end if;
  bad:=jsonb_set(r,'{sha256}',to_jsonb(repeat('B',64)));
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,bad,'Passed') then raise exception 'Digest mismatch accepted';end if;
  update public.qa_candidates set status='error' where id=cid;
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,r,'Passed') then raise exception 'Backfill accepted';end if;
  update public.qa_candidates set status='running' where id=cid;
  update public.qa_candidates set test_config=jsonb_build_object('packageProfileCanonicalJson',canonical||' ') where id=cid;
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,r,'Passed') then raise exception 'Changed canonical bytes accepted';end if;
  update public.qa_candidates set test_config=jsonb_build_object('packageProfileCanonicalJson',canonical) where id=cid;
  update public.packaging_jobs set status='cancelled' where qa_candidate_id=cid;
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,r,'Passed') then raise exception 'Undemanded candidate accepted';end if;
  update public.packaging_jobs set status='awaiting_qa' where qa_candidate_id=cid;
  if not public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,r,'Passed') then raise exception 'Own installed receipt rejected';end if;
  if public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,r,'Passed') then raise exception 'Replay changed evidence';end if;
  if (select count(*) from public.qa_dependency_execution_receipts where candidate_id=cid)<>1 then raise exception 'Write once failed';end if;
  if (select count(*) from public.catalog_file_reputation)<>before_rows then raise exception 'Receipt changed reputation';end if;
  delete from public.qa_dependency_execution_receipts where candidate_id=cid;
  preimage:=replace(replace(preimage,'"exitCode":0','"exitCode":1638'),'"classification":"installed"','"classification":"unconfirmed"');
  r:=preimage::jsonb||jsonb_build_object('sha256',upper(encode(extensions.digest(preimage,'sha256'),'hex')));
  if not public.record_qa_dependency_receipt('local-fixture-only',cid,'123',1,content,r,'Failed') then raise exception 'Truthful unconfirmed/failed evidence lost';end if;
  if (select lifecycle_outcome from public.qa_dependency_execution_receipts where candidate_id=cid)<>'Failed' then raise exception 'Failed evidence converted';end if;
end;
$$;
rollback;
