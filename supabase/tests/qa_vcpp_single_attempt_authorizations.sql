-- Disposable fixture only. No production operation or dispatch is performed.
begin;
-- Only the disposable owner models a future privileged claim.
create function pg_temp.fixture_claim_vcpp(p_id uuid) returns void language plpgsql as $$
declare nonce uuid:=gen_random_uuid();
begin
  update public.qa_vcpp_retest_authorizations set state='dispatch_pending',dispatch_nonce=nonce,
    dispatch_label=winget_id||' '||version||' '||architecture||' [vcpp:'||nonce::text||']',
    expected_source_sha=repeat('c',40),expected_actor_id=456,repository_id=123,
    dispatch_claimed_at=clock_timestamp() where candidate_id=p_id;
end;
$$;

-- Exercise the candidate UPDATE boundary used by timeout, reporter and operator
-- paths. No authorization state change or dispatch is performed here.
create function pg_temp.fixture_assert_vcpp_requeue_denied(p_id uuid) returns void language plpgsql as $$
declare denied boolean:=false;
begin
  begin
    update public.qa_candidates set status='queued' where id=p_id;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Active VC++ authorization requeued';end if;
end;
$$;

do $$
declare cid uuid:='79910000-0000-4000-8000-000000000001';
  newer uuid:='79910000-0000-4000-8000-000000000002';
  expired uuid:='79910000-0000-4000-8000-000000000003';
  canonical text:='{"app":{"wingetId":"Fixture.Vcpp","version":"1.0","architecture":"x64"},"toolchain":{"packagerCommit":"dddddddddddddddddddddddddddddddddddddddd"},"installer":{"sha256":"EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE","packageDependencies":[{"order":1,"packageIdentifier":"Microsoft.VCRedist.2015+.x64","version":"14.51.36247.0","architecture":"x64","sha256":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}]}}';
  profile text; prior jsonb; field text; denied boolean; modified jsonb; text_bytes text; accepted uuid; violated text;
begin
  if has_function_privilege('anon','public.reserve_qa_vcpp_retest(uuid,integer,text,text,text,text,timestamptz)','execute')
    or has_function_privilege('authenticated','public.reserve_qa_vcpp_retest(uuid,integer,text,text,text,text,timestamptz)','execute')
    or not has_function_privilege('service_role','public.reserve_qa_vcpp_retest(uuid,integer,text,text,text,text,timestamptz)','execute')
    then raise exception 'Authorization creator ACL is wrong';end if;
  if has_function_privilege('anon','public.guard_qa_vcpp_candidate_update()','execute')
    or has_function_privilege('authenticated','public.guard_qa_vcpp_candidate_update()','execute')
    or has_function_privilege('service_role','public.guard_qa_vcpp_candidate_update()','execute')
    then raise exception 'Candidate guard exposed as callable API';end if;
  foreach field in array array['INSERT','UPDATE','DELETE','TRUNCATE'] loop
    if has_table_privilege('anon','public.qa_vcpp_retest_authorizations',field)
      or has_table_privilege('authenticated','public.qa_vcpp_retest_authorizations',field)
      or has_table_privilege('service_role','public.qa_vcpp_retest_authorizations',field)
      then raise exception 'Direct authorization mutation granted: %',field;end if;
  end loop;
  if has_table_privilege('anon','public.qa_vcpp_retest_authorizations','SELECT')
    or has_table_privilege('authenticated','public.qa_vcpp_retest_authorizations','SELECT')
    then raise exception 'Authorization provenance exposed';end if;
  if not (select relrowsecurity from pg_class where oid='public.qa_vcpp_retest_authorizations'::regclass)
    then raise exception 'RLS missing';end if;
  profile:=upper(encode(extensions.digest(canonical,'sha256'),'hex'));
  insert into public.qa_candidates(id,winget_id,version,architecture,status,phase,test_level,
    github_run_id,installer_sha256,package_profile_sha256,test_config,enqueued_at,finished_at)
  values(cid,'Fixture.Vcpp','1.0','x64','error','publishing','psadt-package','123',repeat('E',64),profile,
    jsonb_build_object('profileKind','catalog-default','packageProfileCanonicalJson',canonical),
    now()-interval '2 hours',now()-interval '1 hour');
  insert into public.qa_pipeline_control(id,paused,required_packager_commit,scheduler_packager_commit,scheduler_seen_at)
    values('global',false,repeat('d',40),repeat('d',40),now())
    on conflict(id) do update set paused=false,required_packager_commit=repeat('d',40),
      scheduler_packager_commit=repeat('d',40),scheduler_seen_at=now();
  select to_jsonb(c) into prior from public.qa_candidates c where id=cid;
  -- Exercise actual invocations as the denied API roles, not just ACL metadata.
  foreach field in array array['anon','authenticated'] loop
    denied:=false;
    begin
      execute 'set local role '||field;
      perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
    exception when insufficient_privilege then denied:=true;end;
    reset role;
    if not denied then raise exception 'API role created authorization: %',field;end if;
  end loop;
  -- No customer work may be converted into the noncustomer lane.
  insert into public.packaging_jobs(id,qa_candidate_id,status) values(gen_random_uuid(),cid,'awaiting_qa');
  denied:=false;
  begin
    perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Customer-backed reservation accepted';end if;
  delete from public.packaging_jobs where qa_candidate_id=cid;
  foreach field in array array['awaiting_qa','queued','packaging','qa_failed'] loop
    insert into public.packaging_jobs(id,winget_id,version,architecture,installer_sha256,status)
      values(newer,'fixture.vcpp','1.0','x64',repeat('e',64),field);
    denied:=false;
    begin
      perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
    exception when raise_exception then denied:=true;end;
    if not denied then raise exception 'Tuple-linked customer work ignored: %',field;end if;
    delete from public.packaging_jobs where id=newer;
  end loop;
  insert into public.qa_candidates(id,winget_id,version,architecture,status,installer_sha256,
    package_profile_sha256,enqueued_at) values(newer,'Fixture.Vcpp','1.0','x64','running',repeat('E',64),profile,now()-interval '3 hours');
  denied:=false;
  begin
    perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Active identical profile ignored';end if;
  delete from public.qa_candidates where id=newer;
  insert into public.qa_package_results(winget_id,package_profile_sha256) values('Fixture.Vcpp',profile);
  denied:=false;
  begin
    perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Already published profile ignored';end if;
  delete from public.qa_package_results where winget_id='Fixture.Vcpp' and package_profile_sha256=profile;
  insert into public.qa_candidates(id,winget_id,version,architecture,status,installer_sha256,
    package_profile_sha256,enqueued_at) values(newer,'Fixture.Vcpp','2.0','x64','error',repeat('E',64),profile,now());
  denied:=false;
  begin
    perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Newer sibling ignored';end if;
  delete from public.qa_candidates where id=newer;
  -- A newer identical sibling must not spend another lifetime slot either.
  insert into public.qa_candidates(id,winget_id,version,architecture,status,installer_sha256,
    package_profile_sha256,enqueued_at) values(newer,'Fixture.Vcpp','1.0','x64','error',repeat('E',64),profile,now());
  denied:=false;
  begin
    perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Newer identical sibling ignored';end if;
  delete from public.qa_candidates where id=newer;
  -- Validate each semantic guard with a correctly rehashed canonical profile.
  foreach field in array array['identifier','architecture','order','zero_hash','primary_hash','two_dependencies','installer_hash','packager_pin'] loop
    modified:=canonical::jsonb;
    case field
      when 'identifier' then modified:=jsonb_set(modified,'{installer,packageDependencies,0,packageIdentifier}','"Other.Runtime"');
      when 'architecture' then modified:=jsonb_set(modified,'{installer,packageDependencies,0,architecture}','"arm64"');
      when 'order' then modified:=jsonb_set(modified,'{installer,packageDependencies,0,order}','2');
      when 'zero_hash' then modified:=jsonb_set(modified,'{installer,packageDependencies,0,sha256}',to_jsonb(repeat('0',64)));
      when 'primary_hash' then modified:=jsonb_set(modified,'{installer,packageDependencies,0,sha256}',to_jsonb(repeat('E',64)));
      when 'two_dependencies' then modified:=jsonb_set(modified,'{installer,packageDependencies}',(modified#>'{installer,packageDependencies}')||(modified#>'{installer,packageDependencies}'));
      when 'installer_hash' then modified:=jsonb_set(modified,'{installer,sha256}',to_jsonb(repeat('F',64)));
      when 'packager_pin' then modified:=jsonb_set(modified,'{toolchain,packagerCommit}',to_jsonb(repeat('a',40)));
    end case;
    text_bytes:=modified::text;
    update public.qa_candidates set package_profile_sha256=upper(encode(extensions.digest(text_bytes,'sha256'),'hex')),
      test_config=jsonb_set(test_config,'{packageProfileCanonicalJson}',to_jsonb(text_bytes)) where id=cid;
    denied:=false;
    begin
      perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
    exception when raise_exception then denied:=true;end;
    if not denied then raise exception 'Invalid canonical field accepted: %',field;end if;
    update public.qa_candidates set package_profile_sha256=profile,test_config=prior->'test_config' where id=cid;
  end loop;
  foreach field in array array['status','phase','test_level','profileKind','paused','scheduler_pin'] loop
    case field
      when 'status' then update public.qa_candidates set status='running' where id=cid;
      when 'phase' then update public.qa_candidates set phase='installing' where id=cid;
      when 'test_level' then update public.qa_candidates set test_level='installer-preflight' where id=cid;
      when 'profileKind' then update public.qa_candidates set test_config=jsonb_set(test_config,'{profileKind}','"deployment-config"') where id=cid;
      when 'paused' then update public.qa_pipeline_control set paused=true where id='global';
      when 'scheduler_pin' then update public.qa_pipeline_control set scheduler_packager_commit=repeat('a',40) where id='global';
    end case;
    denied:=false;
    begin
      perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
    exception when raise_exception then denied:=true;end;
    if not denied then raise exception 'Invalid candidate/control field accepted: %',field;end if;
    update public.qa_candidates set status='error',phase='publishing',test_level='psadt-package',test_config=prior->'test_config' where id=cid;
    update public.qa_pipeline_control set paused=false,scheduler_packager_commit=repeat('d',40) where id='global';
  end loop;
  foreach field in array array['pr','head','manifest_commit','manifest_blob','review'] loop
    denied:=false;
    begin
      perform public.reserve_qa_vcpp_retest(cid,case when field='pr' then 0 else 123 end,
        case when field='head' then 'invalid' else repeat('b',40) end,
        case when field='manifest_commit' then 'invalid' else repeat('c',40) end,
        case when field='manifest_blob' then 'invalid' else repeat('e',40) end,
        case when field='review' then 'invalid' else repeat('f',64) end,now()+interval '1 hour');
    exception when check_violation then denied:=true;end;
    if not denied then raise exception 'Malformed provenance accepted: %',field;end if;
  end loop;
  -- Hash drift, even whitespace in the canonical bytes, must fail.
  update public.qa_candidates set test_config=jsonb_set(test_config,'{packageProfileCanonicalJson}',to_jsonb(canonical||' ')) where id=cid;
  denied:=false;
  begin
    perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Changed canonical bytes accepted';end if;
  update public.qa_candidates set test_config=jsonb_set(test_config,'{packageProfileCanonicalJson}',to_jsonb(canonical)) where id=cid;
  -- Pin/heartbeat qualification is independent from the stored review hash.
  update public.qa_pipeline_control set scheduler_seen_at=now()-interval '10 minutes' where id='global';
  denied:=false;
  begin
    perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Stale heartbeat accepted';end if;
  update public.qa_pipeline_control set scheduler_seen_at=now() where id='global';
  denied:=false;
  begin
    perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()-interval '1 second');
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Expired reservation accepted';end if;
  denied:=false;
  begin
    perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '25 hours');
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Unbounded reservation accepted';end if;
  set local role service_role;
  accepted:=public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
  reset role;
  if accepted<>cid
    then raise exception 'Valid reservation rejected';end if;
  if (select to_jsonb(c) from public.qa_candidates c where id=cid) is distinct from prior
    then raise exception 'Reservation modified original lifecycle';end if;
  if exists(select 1 from public.qa_vcpp_retest_authorizations where candidate_id=cid
    and (state<>'reserved' or run_id is not null or run_attempt is not null or bound_at is not null))
    then raise exception 'Reservation became execution authority';end if;
  -- Lifetime uniqueness includes terminal reservations; no delete/reissue path.
  -- Catching unique_violation rolls back each attempted state change, so both
  -- iterations start from reserved without a forbidden backwards transition.
  foreach field in array array['expired','failed'] loop
    denied:=false;
    begin
      if field='failed' then
        perform pg_temp.fixture_claim_vcpp(cid);
      end if;
      update public.qa_vcpp_retest_authorizations set state=field where candidate_id=cid;
      perform public.reserve_qa_vcpp_retest(cid,123,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
    exception when unique_violation then denied:=true;end;
    if not denied then raise exception 'Terminal authorization reissued: %',field;end if;
  end loop;
  -- A fake second identity cannot duplicate the same complete execution tuple.
  denied:=false;
  begin
    insert into public.qa_candidates select (jsonb_populate_record(null::public.qa_candidates,prior||jsonb_build_object('id',newer))).*;
    perform public.reserve_qa_vcpp_retest(newer,124,repeat('b',40),repeat('c',40),repeat('e',40),repeat('f',64),now()+interval '1 hour');
  exception when unique_violation then denied:=true;end;
  if not denied then raise exception 'Duplicate complete profile tuple accepted';end if;
  -- All provenance is immutable even for future privileged transition callers.
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set original_head=repeat('a',40) where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Provenance mutation accepted';end if;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set expires_at=expires_at+interval '1 minute' where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Expiry extension accepted';end if;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set state='bound',run_id='456',run_attempt=1,bound_at=clock_timestamp(),run_created_at=dispatch_claimed_at where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Reservation bound without dispatch claim';end if;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set state='dispatch_pending' where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Dispatch claimed without provenance';end if;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set state='dispatch_pending',dispatch_nonce=gen_random_uuid() where candidate_id=cid;
  exception when raise_exception or check_violation then denied:=true;end;
  if not denied then raise exception 'Partial dispatch provenance accepted';end if;
  -- Reserved metadata is not a dispatch claim; the ordinary update path still
  -- works and is restored before exercising the future active states.
  update public.qa_candidates set status='queued' where id=cid;
  update public.qa_candidates set status=prior->>'status' where id=cid;
  -- Full metadata must be initialized only by the dispatch claim transition.
  foreach field in array array['superseded','expired','voided_customer'] loop
    denied:=false;
    begin
      update public.qa_vcpp_retest_authorizations set state=field,
        dispatch_nonce='79910000-0000-4000-8000-000000000006',
        dispatch_label=winget_id||' '||version||' '||architecture||' [vcpp:79910000-0000-4000-8000-000000000006]',
        expected_source_sha=repeat('c',40),expected_actor_id=456,repository_id=123,
        dispatch_claimed_at=clock_timestamp() where candidate_id=cid;
    exception when raise_exception then denied:=true;end;
    if not denied then raise exception 'Provenance initialized outside claim: %',field;end if;
  end loop;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set state='dispatch_pending',
      dispatch_nonce='79910000-0000-4000-8000-000000000006',
      dispatch_label=winget_id||' '||version||' '||architecture||' [vcpp:79910000-0000-4000-8000-000000000006]',
      expected_source_sha=repeat('c',40),expected_actor_id=456,repository_id=123,
      dispatch_claimed_at=clock_timestamp()+interval '2 minutes' where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Future claim time accepted';end if;
  perform pg_temp.fixture_claim_vcpp(cid);
  perform pg_temp.fixture_assert_vcpp_requeue_denied(cid);
  -- Mutate during an otherwise permitted transition, so state ordering alone
  -- cannot make these tests pass when provenance immutability is broken.
  foreach field in array array['expected_actor_id','repository_id','expected_source_sha',
    'dispatch_claimed_at','dispatch_nonce','dispatch_label'] loop
    modified:=case field
      when 'expected_actor_id' then jsonb_build_object(field,457)
      when 'repository_id' then jsonb_build_object(field,124)
      when 'expected_source_sha' then jsonb_build_object(field,repeat('d',40))
      when 'dispatch_claimed_at' then jsonb_build_object(field,clock_timestamp())
      when 'dispatch_nonce' then jsonb_build_object(field,gen_random_uuid())
      else jsonb_build_object(field,'changed label') end;
    denied:=false;
    begin
      update public.qa_vcpp_retest_authorizations a set
        (state,dispatch_nonce,dispatch_label,expected_source_sha,expected_actor_id,repository_id,dispatch_claimed_at)=
        (select 'dispatch_unknown',x.dispatch_nonce,x.dispatch_label,x.expected_source_sha,x.expected_actor_id,x.repository_id,x.dispatch_claimed_at
         from jsonb_populate_record(null::public.qa_vcpp_retest_authorizations,to_jsonb(a)||modified) x)
        where candidate_id=cid;
    exception when raise_exception then denied:=true;end;
    if not denied then raise exception 'Dispatch provenance mutated: %',field;end if;
  end loop;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set state='reserved' where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Dispatch claim reset for replay';end if;
  foreach field in array array['123','122'] loop
    denied:=false;
    begin
      update public.qa_vcpp_retest_authorizations set state='bound',run_id=field,run_attempt=1,bound_at=clock_timestamp(),run_created_at=dispatch_claimed_at where candidate_id=cid;
    exception when raise_exception then denied:=true;end;
    if not denied then raise exception 'Original or older run accepted: %',field;end if;
  end loop;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set state='bound',run_id='456',run_attempt=2,bound_at=clock_timestamp(),run_created_at=dispatch_claimed_at where candidate_id=cid;
  exception when raise_exception or check_violation then denied:=true;end;
  if not denied then raise exception 'Attempt two binding accepted';end if;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set state='bound',run_id='456',run_attempt=1,
      bound_at=clock_timestamp(),run_created_at=dispatch_claimed_at-interval '6 seconds' where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Run predating dispatch window bound';end if;
  update public.qa_vcpp_retest_authorizations set state='dispatch_unknown' where candidate_id=cid;
  perform pg_temp.fixture_assert_vcpp_requeue_denied(cid);
  update public.qa_vcpp_retest_authorizations set state='bound',run_id='456',run_attempt=1,bound_at=clock_timestamp(),run_created_at=dispatch_claimed_at where candidate_id=cid;
  perform pg_temp.fixture_assert_vcpp_requeue_denied(cid);
  foreach field in array array['999',null] loop
    denied:=false;
    begin
      update public.qa_candidates set github_run_id=field where id=cid;
    exception when raise_exception then denied:=true;end;
    if not denied then raise exception 'Bound VC++ candidate run replaced';end if;
  end loop;
  denied:=false;
  begin
    insert into public.qa_candidates select (jsonb_populate_record(null::public.qa_candidates,prior||jsonb_build_object('id',newer))).*;
    insert into public.qa_vcpp_retest_authorizations
      select (jsonb_populate_record(null::public.qa_vcpp_retest_authorizations,to_jsonb(a)||jsonb_build_object(
        'candidate_id',newer,'winget_id','fixture.duplicate-nonce','run_id','999',
        'dispatch_label','fixture.duplicate-nonce 1.0 x64 [vcpp:'||a.dispatch_nonce::text||']'))).*
      from public.qa_vcpp_retest_authorizations a where candidate_id=cid;
  exception when unique_violation then
    get stacked diagnostics violated=constraint_name;
    if violated<>'qa_vcpp_retest_authorizations_dispatch_nonce_key' then raise;end if;
    denied:=true;
  end;
  if not denied then raise exception 'One nonce claimed two authorizations';end if;
  denied:=false;
  begin
    insert into public.qa_candidates select (jsonb_populate_record(null::public.qa_candidates,prior||jsonb_build_object('id',newer))).*;
    insert into public.qa_vcpp_retest_authorizations
      select (jsonb_populate_record(null::public.qa_vcpp_retest_authorizations,
        to_jsonb(a)||jsonb_build_object('candidate_id',newer,'winget_id','fixture.another',
        'dispatch_nonce','79910000-0000-4000-8000-000000000004',
        'dispatch_label','fixture.another 1.0 x64 [vcpp:79910000-0000-4000-8000-000000000004]'))).*
      from public.qa_vcpp_retest_authorizations a where candidate_id=cid;
  exception when unique_violation then
    get stacked diagnostics violated=constraint_name;
    if violated<>'qa_vcpp_retest_one_run' then raise;end if;
    denied:=true;
  end;
  if not denied then raise exception 'One run bound two authorizations';end if;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set run_id='457' where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Bound run rewritten';end if;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set state='passed',run_created_at=run_created_at+interval '1 second' where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Observed creation time rewritten';end if;
  update public.qa_vcpp_retest_authorizations set state='passed' where candidate_id=cid;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set state='failed' where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Terminal outcome rewritten';end if;
  denied:=false;
  begin
    delete from public.qa_vcpp_retest_authorizations where candidate_id=cid;
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Lifetime history deleted';end if;
  -- A legitimately bound run may finish after its reservation deadline.
  insert into public.qa_candidates select (jsonb_populate_record(null::public.qa_candidates,prior||jsonb_build_object('id',newer))).*;
  insert into public.qa_vcpp_retest_authorizations
    select (jsonb_populate_record(null::public.qa_vcpp_retest_authorizations,to_jsonb(a)||jsonb_build_object(
      'candidate_id',newer,'winget_id','fixture.expired-bound','state','bound','run_id','789',
      'created_at',clock_timestamp()-interval '3 hours','expires_at',clock_timestamp()-interval '1 hour',
      'bound_at',now()-interval '2 hours','run_created_at',now()-interval '2 hours',
      'dispatch_claimed_at',now()-interval '2 hours 1 second',
      'dispatch_nonce','79910000-0000-4000-8000-000000000005',
      'dispatch_label','fixture.expired-bound 1.0 x64 [vcpp:79910000-0000-4000-8000-000000000005]'))).*
    from public.qa_vcpp_retest_authorizations a where candidate_id=cid;
  update public.qa_vcpp_retest_authorizations set state='passed' where candidate_id=newer;
  if not exists(select 1 from public.qa_vcpp_retest_authorizations where candidate_id=newer and state='passed')
    then raise exception 'Reservation expiry invalidated a bound run';end if;
  -- Model time passing without sleeping: only the disposable owner inserts history.
  insert into public.qa_candidates select (jsonb_populate_record(null::public.qa_candidates,prior||jsonb_build_object('id',expired))).*;
  insert into public.qa_vcpp_retest_authorizations
    select (jsonb_populate_record(null::public.qa_vcpp_retest_authorizations,to_jsonb(a)||jsonb_build_object(
      'candidate_id',expired,'winget_id','fixture.expired-reserved','state','reserved','run_id',null,
      'run_attempt',null,'bound_at',null,'run_created_at',null,'dispatch_nonce',null,
      'dispatch_label',null,'expected_source_sha',null,'expected_actor_id',null,'repository_id',null,
      'dispatch_claimed_at',null,'created_at',clock_timestamp()-interval '3 hours',
      'expires_at',clock_timestamp()-interval '1 hour'))).*
    from public.qa_vcpp_retest_authorizations a where candidate_id=cid;
  denied:=false;
  begin
    perform pg_temp.fixture_claim_vcpp(expired);
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Expired reservation claimed for dispatch';end if;
  -- Age an unexpired reservation without sleeping. Its stale claim remains
  -- inside the reservation window, so only the one-minute trigger rejects it.
  insert into public.qa_candidates select (jsonb_populate_record(null::public.qa_candidates,
    prior||jsonb_build_object('id','79910000-0000-4000-8000-000000000004'))).*;
  insert into public.qa_vcpp_retest_authorizations
    select (jsonb_populate_record(null::public.qa_vcpp_retest_authorizations,to_jsonb(a)||jsonb_build_object(
      'candidate_id','79910000-0000-4000-8000-000000000004','winget_id','fixture.stale-reserved',
      'state','reserved','run_id',null,'run_attempt',null,'bound_at',null,'run_created_at',null,
      'dispatch_nonce',null,'dispatch_label',null,'expected_source_sha',null,
      'expected_actor_id',null,'repository_id',null,'dispatch_claimed_at',null,
      'created_at',clock_timestamp()-interval '3 minutes','expires_at',clock_timestamp()+interval '1 hour'))).*
    from public.qa_vcpp_retest_authorizations a where candidate_id=cid;
  denied:=false;
  begin
    update public.qa_vcpp_retest_authorizations set state='dispatch_pending',
      dispatch_nonce='79910000-0000-4000-8000-000000000006',
      dispatch_label=winget_id||' '||version||' '||architecture||' [vcpp:79910000-0000-4000-8000-000000000006]',
      expected_source_sha=repeat('c',40),expected_actor_id=456,repository_id=123,
      dispatch_claimed_at=clock_timestamp()-interval '2 minutes'
      where candidate_id='79910000-0000-4000-8000-000000000004';
  exception when raise_exception then denied:=true;end;
  if not denied then raise exception 'Stale claim time accepted';end if;
end;
$$;
rollback;
