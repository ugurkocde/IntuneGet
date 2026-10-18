-- Disposable fixture only. Never run against production.
begin;
truncate public.qa_vt_requests,public.qa_vt_metadata_rechecks,public.qa_vt_submission_intents;
delete from public.qa_candidates;
delete from public.catalog_file_reputation;
update public.qa_vt_request_budget set blocked_until=null;

do $$
declare claim jsonb; old_retry timestamptz; preflight uuid:='30000000-0000-4000-8000-000000000001';
  unseen uuid:='30000000-0000-4000-8000-000000000002';
begin
  insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
    package_profile_sha256,test_level,status,phase,finished_at,dispatched_at,attempts,enqueued_at,installer_url)
  values
    (preflight,'Fixture.Preflight','1','x64','9101',repeat('e',64),repeat('B',64),'psadt-package',
      'error','publishing',now()-interval '1 hour',now()-interval '2 hours',1,now()-interval '3 hours',
      'https://example.invalid/preflight'),
    (unseen,'Fixture.Unseen','1','x64','9102',repeat('f',64),repeat('B',64),'psadt-package',
      'error','publishing',now()-interval '1 hour',now()-interval '2 hours',1,now()-interval '3 hours',
      'https://example.invalid/unseen');
  insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at,
    attempts,last_http_status)
  values(preflight,repeat('e',64),repeat('B',64),'9101',now()-interval '1 hour',1,404),
    (unseen,repeat('f',64),repeat('B',64),'9102',now()-interval '1 minute',0,null);
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->'nextPreflight'->>'candidateId' is distinct from preflight::text
    or exists(select 1 from public.qa_vt_requests) then
    raise exception 'Unseen metadata starved an eligible genuine404 preflight';end if;
  -- The active preflight lease cannot be offered twice; unseen work can proceed.
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'candidateId' is distinct from unseen::text or claim->>'reservationId' is null
    or (select count(*) from public.qa_vt_requests)<>1 then
    raise exception 'Active preflight replayed or blocked unseen lookup';end if;
  -- Completed preflight never turns back into another provider lookup.
  truncate public.qa_vt_requests;
  update public.qa_vt_metadata_rechecks set state='pending',lease=null,lease_expires_at=null;
  update public.qa_vt_metadata_rechecks set preflight_completed_at=now(),
    preflight_lease=null,preflight_lease_expires_at=null where candidate_id=preflight;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'candidateId' is distinct from unseen::text or claim->>'reservationId' is null then
    raise exception 'Completed preflight repeated or starved unseen lookup';end if;
  -- Customer demand retains precedence over the preflight preference.
  truncate public.qa_vt_requests;
  update public.qa_vt_metadata_rechecks set state='pending',lease=null,lease_expires_at=null;
  update public.qa_vt_metadata_rechecks set preflight_completed_at=null,preflight_attempts=0
    where candidate_id=preflight;
  insert into public.packaging_jobs(id,qa_candidate_id,status)
    values('30000000-0000-4000-8000-000000000003',unseen,'awaiting_qa');
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim->>'candidateId' is distinct from unseen::text or claim->>'reservationId' is null then
    raise exception 'Preflight preference displaced waiting customer demand';end if;
  -- A provider block must neither spend quota nor relabel a genuine404 for lookup.
  truncate public.qa_vt_requests;
  update public.qa_vt_metadata_rechecks set state='resolved' where candidate_id=unseen;
  update public.qa_vt_request_budget set blocked_until=now()+interval '1 hour';
  select retry_at into old_retry from public.qa_vt_metadata_rechecks where candidate_id=preflight;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim ? 'nextPreflight' or claim->>'reservationId' is not null
    or exists(select 1 from public.qa_vt_requests)
    or (select retry_at from public.qa_vt_metadata_rechecks where candidate_id=preflight)<>old_retry then
    raise exception 'Blocked404 spent quota or reset its retry deadline';end if;
  update public.qa_vt_request_budget set blocked_until=null;
  -- Exhausted and non-public preflights remain excluded after the new sort key.
  update public.qa_vt_metadata_rechecks set preflight_attempts=2 where candidate_id=preflight;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim ? 'nextPreflight' or claim->>'reservationId' is not null then
    raise exception 'Exhausted404 repeated a preflight or lookup';end if;
  update public.qa_vt_metadata_rechecks set preflight_attempts=0 where candidate_id=preflight;
  update public.qa_candidates set winget_id='Custom.Preflight' where id=preflight;
  claim:=public.claim_qa_vt_metadata_recheck('local-fixture-only');
  if claim ? 'nextPreflight' or claim->>'reservationId' is not null then
    raise exception 'Nonpublic404 bypassed the source boundary';end if;
end $$;
rollback;
