-- Synthetic disposable contract. Never execute against production.
begin;
truncate public.qa_vt_upload_url_recovery_grants,public.qa_vt_requests,
  public.qa_vt_metadata_rechecks,public.qa_vt_submission_intents;
delete from public.qa_candidates;
delete from public.catalog_file_reputation;
update public.qa_vt_request_budget set blocked_until=null;
insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
  package_profile_sha256,test_level,status,phase,dispatched_at,attempts,enqueued_at,installer_url)
select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Fixture.NoUpload'||n,'1','x64',n::text,
  case when n=1 then '7bec66953457f6bc78bce9f0a1dcdde1c4cf2a8f8ac26f73fcecf5738f42f307' else repeat('d',64) end,
  repeat('B',64),'psadt-package','running','preflight',now()-interval '2 hours',1,
  now()-interval '3 hours','https://example.invalid/installer'
from generate_series(1,2) n;
insert into public.qa_vt_requests(sha256,operation,reserved_at,candidate_id,response_recorded_at)
select lower(installer_sha256),'hash_lookup',now()-interval '4 minutes',id,now()-interval '4 minutes'
from public.qa_candidates;
insert into public.qa_vt_submission_intents(sha256,candidate_id,winget_id,version,architecture,
  manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at,dispatch_started_at,
  dispatch_attempt,profile_sha256,github_run_id,hash_lookup_reservation_id,hash_not_found_at)
select lower(c.installer_sha256),c.id,c.winget_id,c.version,c.architecture,c.installer_url,c.installer_url,
  'fixture',now()-interval '5 minutes',c.dispatched_at,c.attempts,c.package_profile_sha256,c.github_run_id,
  r.id,r.reserved_at from public.qa_candidates c join public.qa_vt_requests r on r.candidate_id=c.id;
do $$
declare cid uuid:='30000000-0000-4000-8000-000000000001';
  other_id uuid:='30000000-0000-4000-8000-000000000002';
  h text:='7bec66953457f6bc78bce9f0a1dcdde1c4cf2a8f8ac26f73fcecf5738f42f307';
  result jsonb; op text; before_state jsonb; after_state jsonb;
begin
  select jsonb_build_array((select jsonb_agg(to_jsonb(r)) from public.qa_vt_requests r),
    (select jsonb_agg(to_jsonb(i)) from public.qa_vt_submission_intents i),
    (select to_jsonb(b) from public.qa_vt_request_budget b)) into before_state;
  foreach op in array array['upload_url','upload','upload_url','upload'] loop
    result:=public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,op);
    if result is distinct from '{"stop":"defender_pilot_no_upload"}'::jsonb then
      raise exception 'Pilot upload was not refused';
    end if;
  end loop;
  select jsonb_build_array((select jsonb_agg(to_jsonb(r)) from public.qa_vt_requests r),
    (select jsonb_agg(to_jsonb(i)) from public.qa_vt_submission_intents i),
    (select to_jsonb(b) from public.qa_vt_request_budget b)) into after_state;
  if after_state is distinct from before_state then raise exception 'Refusal consumed quota or changed evidence';end if;
  begin
    perform public.reserve_qa_vt_candidate_request('wrong-fixture',cid,h,'upload');
    raise exception 'TEST unauthenticated refusal accepted';
  exception when others then if sqlerrm='TEST unauthenticated refusal accepted' then raise;end if;end;
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',other_id,h,'upload');
    raise exception 'TEST wrong hash accepted';
  exception when others then if sqlerrm<>'QA VirusTotal installer hash rejected' then raise;end if;end;
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',cid,upper(h),'upload');
    raise exception 'TEST malformed hash accepted';
  exception when others then if sqlerrm<>'QA VirusTotal request binding rejected' then raise;end if;end;
  begin
    perform public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'upload',gen_random_uuid());
    raise exception 'TEST invalid lease accepted';
  exception when others then if sqlerrm<>'QA VirusTotal recheck lease rejected' then raise;end if;end;
  result:=public.reserve_qa_vt_candidate_request('local-fixture-only',cid,h,'hash_lookup');
  if result->>'reservationId' is null then raise exception 'Pilot hash lookup blocked';end if;
  result:=public.reserve_qa_vt_candidate_request('local-fixture-only',other_id,repeat('d',64),'upload_url');
  if result->>'reservationId' is null then raise exception 'Unrelated upload URL blocked';end if;
  result:=public.reserve_qa_vt_candidate_request('local-fixture-only',other_id,repeat('d',64),'upload');
  if result->>'reservationId' is null then raise exception 'Unrelated upload blocked';end if;
end;
$$;
rollback;
