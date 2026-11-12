-- Synthetic PostgreSQL fixture only; never run against production.
-- Count predicate calls, not elapsed time, to avoid machine-dependent timing gates.
begin;
truncate public.qa_vt_upload_url_recovery_grants,public.qa_vt_requests,
  public.qa_vt_metadata_rechecks,public.qa_vt_submission_intents;
delete from public.packaging_jobs;
delete from public.qa_candidates;

insert into public.qa_candidates(id,winget_id,version,architecture,github_run_id,installer_sha256,
  package_profile_sha256,test_level,status,phase,finished_at,dispatched_at,attempts,enqueued_at)
select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'Fixture.Admission.'||n,'1','x64',n::text,lpad(to_hex(n),64,'a'),repeat('B',64),
  case when n>300 and n<=2300 and n%3=0 then 'installer' else 'psadt-package' end,
  case when n>300 and n<=2300 and n%3=2 then 'queued' else 'error' end,
  case when n>300 and n<=2300 and n%3=1 then 'preparing_package' else 'publishing' end,
  now()-interval '1 hour',now()-interval '2 hours',1,now()-interval '3 hours'
from generate_series(1,2309) n;
update public.qa_candidates set installer_sha256=repeat('0',64) where github_run_id='2301';
update public.qa_candidates set github_run_id='not-a-run' where github_run_id='2302';
update public.qa_candidates set package_profile_sha256='invalid' where github_run_id='2303';
update public.qa_candidates set dispatched_at=null where github_run_id='2304';
update public.qa_candidates set finished_at=now()-interval '15 days' where github_run_id='2306';
update public.qa_candidates set winget_id='Fixture.Admission.2305',version='2',status='queued',
  enqueued_at=now(),phase=null where github_run_id='2307';
update public.qa_candidates set finished_at=now()+interval '1 day' where github_run_id='2308';
update public.qa_candidates set finished_at=now()-interval '14 days' where github_run_id='2309';
insert into public.packaging_jobs(id,qa_candidate_id,status)
select gen_random_uuid(),id,'awaiting_qa' from public.qa_candidates
where case when github_run_id ~ '^[0-9]+$'
  then github_run_id::integer<=300 and github_run_id::integer%3=0 else false end;
insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,state,attempts,retry_at)
select id,lower(installer_sha256),package_profile_sha256,github_run_id,'escalated',6,now()
from public.qa_candidates where github_run_id='1';

-- The original SELECT remains the equivalence oracle, independently of the patch.
alter function public.qa_vt_terminal_identity(uuid) rename to fixture_original_terminal_identity;
create sequence public.fixture_identity_calls;
create function public.qa_vt_terminal_identity(p_candidate_id uuid) returns boolean
language plpgsql stable set search_path to '' as $$
begin
  perform pg_catalog.nextval('public.fixture_identity_calls');
  return public.fixture_original_terminal_identity(p_candidate_id);
end;
$$;

do $$
declare expected uuid[]; before_ids uuid[]; actual uuid[]; inserted integer;
  calls bigint; cheap_rows integer; batch integer; admitted integer:=0;
begin
  -- Repeated calls drain >100 eligible rows; they are not immediately idempotent.
  for batch in 1..4 loop
    select array_agg(v.id order by v.customer desc,v.finished_at,v.id) into expected from (
      select c.id,c.finished_at,exists(select 1 from public.packaging_jobs j
        where j.qa_candidate_id=c.id and j.status='awaiting_qa') customer
      from public.qa_candidates c
      where public.fixture_original_terminal_identity(c.id)
        and c.finished_at>=clock_timestamp()-interval '14 days'
        and not exists(select 1 from public.qa_vt_metadata_rechecks q
          where q.candidate_id=c.id and q.run_id=c.github_run_id)
      order by customer desc,c.finished_at,c.id limit 100
    ) v;
    expected:=coalesce(expected,'{}'::uuid[]);
    select array_agg(candidate_id) into before_ids from public.qa_vt_metadata_rechecks;
    select count(*) into cheap_rows from public.qa_candidates c
      where c.test_level='psadt-package' and c.phase='publishing'
        and c.status in ('error','failed','passed') and c.finished_at is not null
        and c.finished_at>=clock_timestamp()-interval '14 days';
    perform pg_catalog.setval('public.fixture_identity_calls',1,false);
    inserted:=public.admit_qa_vt_terminal_metadata_rechecks('local-fixture-only');
    select case when is_called then last_value else 0 end into calls from public.fixture_identity_calls;
    select coalesce(array_agg(candidate_id order by candidate_id),'{}'::uuid[]) into actual
      from public.qa_vt_metadata_rechecks where not(candidate_id=any(before_ids));
    if inserted<>cardinality(expected) or actual is distinct from
      array(select unnest(expected) order by 1) then
      raise exception 'Admission set/order differs from original SELECT in batch %',batch;
    end if;
    if calls>cheap_rows then
      raise exception 'Opaque identity predicate reached decoys: % calls, % prefiltered rows',calls,cheap_rows;
    end if;
    if batch<=2 and inserted<>100 then raise exception 'First two batches must admit 100';end if;
    if batch=3 and inserted<>99 then raise exception 'Final nonempty batch must admit 99';end if;
    if batch=4 and inserted<>0 then raise exception 'Drained admission must be idempotent';end if;
    admitted:=admitted+inserted;
  end loop;
  if admitted<>299 then raise exception 'Unexpected eligible total';end if;
  if not exists(select 1 from public.qa_vt_metadata_rechecks where run_id='1'
    and state='escalated' and attempts=6) then raise exception 'Existing budget was reset';end if;
  if exists(select 1 from public.qa_vt_requests) then raise exception 'Admission reserved provider quota';end if;
end;
$$;
rollback;
