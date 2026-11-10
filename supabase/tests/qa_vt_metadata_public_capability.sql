-- Synthetic disposable PostgreSQL contract. Never run against production.
begin;
truncate public.qa_vt_upload_url_recovery_grants,public.qa_vt_requests,
  public.qa_vt_metadata_rechecks,public.qa_vt_submission_intents;
delete from public.packaging_jobs;
delete from public.qa_candidates;
delete from public.catalog_file_reputation;
update public.qa_vt_request_budget set blocked_until=null;
update public.qa_vt_claim_lane set last_lane='public';
insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,
  installer_sha256,package_profile_sha256,test_level,status,phase,finished_at,
  dispatched_at,attempts,enqueued_at,installer_url)
select ('87400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'Fixture.Capability'||n,'1','x64',('98740'||n),repeat(n::text,64),repeat('B',64),
  'psadt-package','error','publishing',now()-interval '1 hour',
  now()-interval '2 hours',1,now()-interval '3 hours','https://example.invalid/installer'
from generate_series(1,4) n;
insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,
  retry_at,last_http_status)
select id,lower(installer_sha256),package_profile_sha256,github_run_id,
  now()-interval '1 minute',404 from public.qa_candidates where winget_id='Fixture.Capability1';
insert into public.qa_vt_submission_intents(sha256,candidate_id,winget_id,version,
  architecture,manifest_installer_url,execution_installer_url,preflight_cache_key,
  verified_at,dispatch_started_at,dispatch_attempt,profile_sha256,github_run_id)
select lower(installer_sha256),id,winget_id,version,architecture,installer_url,
  installer_url,'qa-vt-terminal:fixture',now()-interval '2 minutes',dispatched_at,
  attempts,package_profile_sha256,github_run_id from public.qa_candidates
where winget_id in ('Fixture.Capability3','Fixture.Capability4');
update public.qa_vt_submission_intents set outcome='submitted',analysis_id='fixture_analysis',
  upload_url_reserved_at=now()-interval '30 minutes',upload_reserved_at=now()-interval '29 minutes',
  analysis_recorded_at=now()-interval '28 minutes' where winget_id='Fixture.Capability4';
do $$
declare before_rows jsonb; after_rows jsonb; claim jsonb;
begin
  select jsonb_build_array(
    (select jsonb_agg(q) from public.qa_vt_metadata_rechecks q),
    (select jsonb_agg(q) from public.qa_vt_submission_intents q),
    (select jsonb_agg(q) from public.qa_vt_requests q),
    (select jsonb_agg(q) from public.qa_vt_request_budget q),
    (select jsonb_agg(q) from public.qa_vt_claim_lane q)) into before_rows;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only',false);
  if claim<>jsonb_build_object('stop','no_eligible_work') then
    raise exception 'Unsupported public work selected';end if;
  select jsonb_build_array(
    (select jsonb_agg(q) from public.qa_vt_metadata_rechecks q),
    (select jsonb_agg(q) from public.qa_vt_submission_intents q),
    (select jsonb_agg(q) from public.qa_vt_requests q),
    (select jsonb_agg(q) from public.qa_vt_request_budget q),
    (select jsonb_agg(q) from public.qa_vt_claim_lane q)) into after_rows;
  if before_rows is distinct from after_rows then
    raise exception 'Unsupported work consumed counters, leases, cursor or reservations';end if;
  -- Higher-priority customer preflight must not block the next hash lookup.
  insert into public.packaging_jobs(id,qa_candidate_id,status) values
    ('87410000-0000-4000-8000-000000000001','87400000-0000-4000-8000-000000000001','awaiting_qa');
  insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at)
  select id,lower(installer_sha256),package_profile_sha256,github_run_id,now()-interval '1 minute'
    from public.qa_candidates where winget_id='Fixture.Capability2';
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only',false);
  if claim->>'candidateId'<>'87400000-0000-4000-8000-000000000002'
    or claim->>'reservationId' is null then raise exception 'Public work blocked hash lookup';end if;
  if exists(select 1 from public.qa_vt_metadata_rechecks where candidate_id=
    '87400000-0000-4000-8000-000000000001' and
    (preflight_attempts<>0 or preflight_lease is not null or preflight_completed_at is not null)) then
    raise exception 'Skipped preflight consumed an attempt';end if;
  if exists(select 1 from public.qa_vt_requests where operation<>'hash_lookup') then
    raise exception 'Capability created a public reservation';end if;
end $$;
rollback;
