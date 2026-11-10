-- Disposable PostgreSQL contract only; all fixture changes roll back.
begin;
do $$
declare active uuid:='83800000-0000-4000-8000-000000000001';
  held uuid:='83800000-0000-4000-8000-000000000002';
  hash text:=repeat('c0',32); claimed jsonb;
begin
  insert into public.qa_candidates(id,winget_id,version,architecture,status,test_level,
    installer_sha256,priority,next_retry_at)
  values(active,'Fixture.Active','1','x64','running','psadt-package',repeat('c1',32),1,now()),
    (held,'Fixture.Held','1','x64','error','psadt-package',upper(hash),999999999,now());
  insert into public.qa_installer_security_holds(sha256,malicious_verdicts,first_held_at,
    verdict_at,next_check_at,checked_at)
  values(hash,1,now()-interval '10 days',now()-interval '10 days',now()-interval '1 day',now());
  insert into public.qa_vt_requests(sha256,operation,reserved_at)
    values(hash,'hash_lookup',now()-interval '2 days');
  claimed:=public.claim_qa_installer_security_rechecks('local-fixture-only',active,5);
  if claimed @> jsonb_build_array(jsonb_build_object('sha256',hash)) then
    raise exception 'No-demand hash rechecked before seven days';end if;
  insert into public.packaging_jobs(id,qa_candidate_id,status)
    values('83800000-0000-4000-8000-000000000003',held,'awaiting_qa');
  claimed:=public.claim_qa_installer_security_rechecks('local-fixture-only',active,5);
  if not claimed @> jsonb_build_array(jsonb_build_object('sha256',hash)) then
    raise exception 'Demand did not restore daily on next pass';end if;
  if exists(select 1 from public.qa_installer_security_holds where sha256=hash
    and (released_at is not null or next_check_at<>now()+interval '24 hours')) then
    raise exception 'Claim changed hold or stored a weekly floor';end if;
end;
$$;
rollback;
