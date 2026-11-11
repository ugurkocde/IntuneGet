-- Disposable database only. All fixture changes roll back, including clock seams.
begin;
truncate public.qa_vt_upload_url_recovery_grants,public.qa_vt_requests,
  public.qa_vt_metadata_rechecks,public.qa_vt_submission_intents;
delete from public.qa_candidates;
delete from public.catalog_file_reputation;
delete from public.qa_installer_security_holds;
update public.qa_vt_request_budget set blocked_until=null;
insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,
  package_profile_sha256,test_level,status,phase,attempts,installer_url)
values('de979d31-562f-40ef-9dd1-3752fa091953','Adobe.Acrobat.Reader.64-bit','26.003.22075','x64',
 '7bec66953457f6bc78bce9f0a1dcdde1c4cf2a8f8ac26f73fcecf5738f42f307',
 'BE9876C429C9ADB461675ADC80E58E7890A7F5F41C26275BDD3DDA694C48CDCA',
 'psadt-package','queued','queued',0,'https://example.invalid/fixture');
insert into public.qa_installer_security_holds(sha256,malicious_verdicts)
select installer_sha256,0 from public.qa_candidates;

create function pg_temp.reader_lookup() returns jsonb language sql as $$
 select public.reserve_qa_vt_candidate_request('local-fixture-only',
 'de979d31-562f-40ef-9dd1-3752fa091953',
 '7bec66953457f6bc78bce9f0a1dcdde1c4cf2a8f8ac26f73fcecf5738f42f307','hash_lookup')
$$;
create function pg_temp.reader_refused() returns void language plpgsql as $$
begin
  begin
    perform pg_temp.reader_lookup();
    raise exception 'TEST scan-only lookup accepted';
  exception when others then
    if sqlerrm='TEST scan-only lookup accepted' then raise;end if;
  end;
end;
$$;

do $$
declare target regprocedure:='public.reserve_qa_vt_candidate_request(text,uuid,text,text,uuid)'::regprocedure;
 source text:=pg_get_functiondef(target); expired_source text; r jsonb; rid uuid;
 reporter_source text:=pg_get_functiondef('public.report_qa_vt_candidate_rate_limit(text,uuid,uuid,timestamptz)'::regprocedure);
 candidate_before jsonb; hold_before jsonb; properties_before jsonb; op text;
begin
  -- Fail before the patch, independently of the calendar date.
  if position('QA VirusTotal scan-only binding rejected' in source)=0 then
    raise exception 'Reader scan-only reservation unavailable';end if;
  if position('2026-11-11 21:00:00+00' in source)=0 then raise exception 'Missing fixed deadline';end if;
  select jsonb_build_array(proowner,proacl::text,prosecdef,proconfig,provolatile)
    into properties_before from pg_proc where oid=target;
  -- Exercise both clock boundaries after the real deadline too. Only disposable
  -- function text changes here; the transaction restores the shipped definition.
  expired_source:=replace(source,'2026-11-11 21:00:00+00','2000-01-01 00:00:00+00');
  execute expired_source;
  perform pg_temp.reader_refused();
  execute replace(source,'2026-11-11 21:00:00+00','infinity');
  select to_jsonb(c) into candidate_before from public.qa_candidates c;
  select to_jsonb(h) into hold_before from public.qa_installer_security_holds h;

  foreach op in array array['upload','upload_url','analysis_lookup'] loop
    begin
      perform public.reserve_qa_vt_candidate_request('local-fixture-only',
        (candidate_before->>'id')::uuid,candidate_before->>'installer_sha256',op);
      raise exception 'TEST non-lookup accepted';
    exception when others then if sqlerrm='TEST non-lookup accepted' then raise;end if;end;
  end loop;
  begin
    perform public.reserve_qa_vt_candidate_request('wrong-secret',
      (candidate_before->>'id')::uuid,candidate_before->>'installer_sha256','hash_lookup');
    raise exception 'TEST unauthenticated scan accepted';
  exception when others then if sqlerrm='TEST unauthenticated scan accepted' then raise;end if;end;
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',
      (candidate_before->>'id')::uuid,candidate_before->>'installer_sha256','hash_lookup',gen_random_uuid());
    raise exception 'TEST leased scan accepted';
  exception when others then if sqlerrm='TEST leased scan accepted' then raise;end if;end;
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',
      (candidate_before->>'id')::uuid,repeat('a',64),'hash_lookup');
    raise exception 'TEST wrong hash accepted';
  exception when others then if sqlerrm='TEST wrong hash accepted' then raise;end if;end;
  update public.qa_candidates set id='11111111-1111-4111-8111-111111111111';
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',
      '11111111-1111-4111-8111-111111111111',candidate_before->>'installer_sha256','hash_lookup');
    raise exception 'TEST other candidate accepted';
  exception when others then if sqlerrm='TEST other candidate accepted' then raise;end if;end;
  update public.qa_candidates set id=(candidate_before->>'id')::uuid;

  update public.qa_candidates set package_profile_sha256=repeat('A',64);
  perform pg_temp.reader_refused();
  update public.qa_candidates set package_profile_sha256=candidate_before->>'package_profile_sha256';
  update public.qa_candidates set architecture='arm64';perform pg_temp.reader_refused();
  update public.qa_candidates set architecture='x64';
  update public.qa_candidates set version='0';perform pg_temp.reader_refused();
  update public.qa_candidates set version='26.003.22075';
  update public.qa_installer_security_holds set released_at=now();perform pg_temp.reader_refused();
  update public.qa_installer_security_holds set released_at=null,malicious_verdicts=1;
  perform pg_temp.reader_refused();
  update public.qa_installer_security_holds set malicious_verdicts=0;
  insert into public.catalog_file_reputation(sha256,status) values(candidate_before->>'installer_sha256','found');
  perform pg_temp.reader_refused();delete from public.catalog_file_reputation;
  select to_jsonb(c) into candidate_before from public.qa_candidates c;
  select to_jsonb(h) into hold_before from public.qa_installer_security_holds h;
  r:=pg_temp.reader_lookup();rid:=(r->>'reservationId')::uuid;
  if rid is null or r ? 'cached' then raise exception 'Scan-only reservation missing or cached';end if;
  if not exists(select 1 from public.qa_vt_requests where id=rid and candidate_id=(candidate_before->>'id')::uuid
    and recheck_lease is null and operation='hash_lookup') then raise exception 'Reservation not bound';end if;
  perform pg_temp.reader_refused();
  if (select count(*) from public.qa_vt_requests)<>1 then raise exception 'One-shot budget exceeded';end if;
  begin
    perform public.report_qa_vt_candidate_rate_limit('local-fixture-only',
      (candidate_before->>'id')::uuid,gen_random_uuid(),now()+interval '1 hour');
    raise exception 'TEST unrelated reservation accepted';
  exception when others then if sqlerrm='TEST unrelated reservation accepted' then raise;end if;end;
  -- A recently reserved request remains reportable after cutoff. Shift only
  -- the disposable reporter's cutoff to 30 seconds ago, keeping the reservation
  -- recent enough for the unchanged shared helper's five-minute check.
  update public.qa_vt_requests set reserved_at=clock_timestamp()-interval '60 seconds' where id=rid;
  execute replace(reporter_source,quote_literal('2026-11-11 21:00:00+00')||'::timestamptz',
    quote_literal((clock_timestamp()-interval '30 seconds')::text)||'::timestamptz');
  perform public.report_qa_vt_candidate_rate_limit('local-fixture-only',
    (candidate_before->>'id')::uuid,rid,now()+interval '1 hour');
  if not exists(select 1 from public.qa_vt_request_budget where blocked_until>=now()+interval '59 minutes') then
    raise exception 'Shared Retry-After not retained';end if;
  if exists(select 1 from public.qa_vt_metadata_rechecks) or exists(select 1 from public.qa_vt_submission_intents) then
    raise exception 'Scan created ordinary replay evidence';end if;
  if (select to_jsonb(c) from public.qa_candidates c) is distinct from candidate_before
    or (select to_jsonb(h) from public.qa_installer_security_holds h) is distinct from hold_before then
    raise exception 'Scan changed candidate or hold';end if;
  if properties_before is distinct from (select jsonb_build_array(proowner,proacl::text,prosecdef,proconfig,provolatile)
    from pg_proc where oid=target) then raise exception 'Function ACL or properties changed';end if;
end;
$$;
rollback;
