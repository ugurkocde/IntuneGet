-- Synthetic PostgreSQL fixture only; never run against production.
-- Proves that already-admitted recent publishing candidates do not invoke
-- qa_vt_terminal_identity(), that catalog-scale scans use the partial index,
-- and that exact customer-first admission parity and budget preservation hold.
begin;
truncate public.qa_vt_upload_url_recovery_grants, public.qa_vt_requests,
  public.qa_vt_metadata_rechecks, public.qa_vt_submission_intents;
delete from public.packaging_jobs;
delete from public.qa_candidates;

-- 5000 older historical rows outside the 14-day window (or non-publishing)
-- plus 300 recent publishing rows already admitted, plus 8 unadmitted rows
-- (5 eligible, 3 invalid/superseded).
insert into public.qa_candidates(id, winget_id, version, architecture, github_run_id, installer_sha256,
  package_profile_sha256, test_level, status, phase, finished_at, dispatched_at, attempts, enqueued_at)
select ('72000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Fixture.Antijoin.Hist.' || n, '1', 'x64', (100000 + n)::text, lpad(to_hex(n), 64, 'a'), repeat('B', 64),
  'psadt-package', 'passed', 'completed',
  now() - interval '30 days', now() - interval '31 days', 1, now() - interval '31 days'
from generate_series(1, 5000) n;

insert into public.qa_candidates(id, winget_id, version, architecture, github_run_id, installer_sha256,
  package_profile_sha256, test_level, status, phase, finished_at, dispatched_at, attempts, enqueued_at)
select ('73000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Fixture.Antijoin.Admitted.' || n, '1', 'x64', (200000 + n)::text, lpad(to_hex(n), 64, 'c'), repeat('D', 64),
  'psadt-package', 'error', 'publishing',
  now() - interval '2 days', now() - interval '2 days' - interval '5 minutes', 1, now() - interval '2 days' - interval '10 minutes'
from generate_series(1, 300) n;

insert into public.qa_vt_metadata_rechecks(candidate_id, sha256, profile_sha256, run_id, state, attempts, retry_at)
select id, lower(installer_sha256), package_profile_sha256, github_run_id,
  case when github_run_id = '200001' then 'escalated' else 'resolved' end,
  case when github_run_id = '200001' then 6 else 1 end,
  now()
from public.qa_candidates
where winget_id like 'Fixture.Antijoin.Admitted.%';

-- 5 eligible unadmitted rows (2 customer-awaited, 3 ordinary) + 1 superseded + 1 zero-hash + 1 future finished_at
insert into public.qa_candidates(id, winget_id, version, architecture, github_run_id, installer_sha256,
  package_profile_sha256, test_level, status, phase, finished_at, dispatched_at, attempts, enqueued_at)
select ('74000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Fixture.Antijoin.New.' || n, '1', 'x64', (300000 + n)::text, lpad(to_hex(n), 64, 'e'), repeat('F', 64),
  'psadt-package', 'error', 'publishing',
  now() - (10 - n) * interval '1 hour', now() - interval '12 hours', 1, now() - interval '13 hours'
from generate_series(1, 8) n;

-- Candidate 6 is superseded by a newer queued version
insert into public.qa_candidates(id, winget_id, version, architecture, github_run_id, installer_sha256,
  package_profile_sha256, test_level, status, phase, finished_at, dispatched_at, attempts, enqueued_at)
values (
  '74000000-0000-4000-8000-000000000099'::uuid,
  'Fixture.Antijoin.New.6', '2', 'x64', '300099', lpad('99', 64, 'e'), repeat('F', 64),
  'psadt-package', 'queued', null, null, null, 0, now()
);
-- Candidate 7 has zero hash; candidate 8 has future finished_at
update public.qa_candidates set installer_sha256 = repeat('0', 64) where github_run_id = '300007';
update public.qa_candidates set finished_at = now() + interval '1 hour' where github_run_id = '300008';

-- Mark candidates 4 and 5 as customer-awaited
insert into public.packaging_jobs(id, qa_candidate_id, status)
select gen_random_uuid(), id, 'awaiting_qa'
from public.qa_candidates
where github_run_id in ('300004', '300005');

analyze public.qa_candidates;
analyze public.qa_vt_metadata_rechecks;

alter function public.qa_vt_terminal_identity(uuid) rename to fixture_antijoin_orig_identity;
create sequence public.fixture_antijoin_identity_calls;
create function public.qa_vt_terminal_identity(p_candidate_id uuid) returns boolean
language plpgsql stable set search_path to '' as $$
begin
  perform pg_catalog.nextval('public.fixture_antijoin_identity_calls');
  return public.fixture_antijoin_orig_identity(p_candidate_id);
end;
$$;

do $$
declare
  expected uuid[];
  before_ids uuid[];
  actual uuid[];
  inserted integer;
  calls bigint;
  plan json;
begin
  -- Reference oracle: exact admitted set for first pass
  select array_agg(v.id order by v.id) into expected from (
    select c.id
    from public.qa_candidates c
    where public.fixture_antijoin_orig_identity(c.id)
      and c.finished_at >= clock_timestamp() - interval '14 days'
      and not exists (
        select 1 from public.qa_vt_metadata_rechecks q
        where q.candidate_id = c.id and q.run_id = c.github_run_id
      )
  ) v;
  select array_agg(candidate_id) into before_ids from public.qa_vt_metadata_rechecks;

  -- Pass 1: 300 already-admitted + 6 structurally valid unadmitted (5 eligible + 1 superseded)
  perform pg_catalog.setval('public.fixture_antijoin_identity_calls', 1, false);
  inserted := public.admit_qa_vt_terminal_metadata_rechecks('local-fixture-only');
  select case when is_called then last_value else 0 end into calls from public.fixture_antijoin_identity_calls;
  select coalesce(array_agg(candidate_id order by candidate_id), '{}'::uuid[]) into actual
    from public.qa_vt_metadata_rechecks where not (candidate_id = any(before_ids));

  if inserted <> 5 or actual is distinct from expected then
    raise exception 'First admission pass mismatch: inserted=%, expected=%', inserted, cardinality(expected);
  end if;
  if calls > 6 then
    raise exception 'Already-admitted rows reached opaque identity predicate on pass 1: % calls (max 6)', calls;
  end if;

  -- Pass 2 (drained steady state): 305 already-admitted + 1 superseded unadmitted
  perform pg_catalog.setval('public.fixture_antijoin_identity_calls', 1, false);
  inserted := public.admit_qa_vt_terminal_metadata_rechecks('local-fixture-only');
  select case when is_called then last_value else 0 end into calls from public.fixture_antijoin_identity_calls;

  if inserted <> 0 then
    raise exception 'Drained pass must insert 0 rows, got %', inserted;
  end if;
  if calls > 1 then
    raise exception 'Already-admitted rows reached opaque identity predicate on drained pass: % calls (max 1)', calls;
  end if;

  -- Verify index is used for the recent publishing prefilter at catalog scale
  execute $plan$explain (format json)
    select c.id
    from public.qa_candidates c
    where c.test_level = 'psadt-package'
      and c.phase = 'publishing'
      and c.status in ('error', 'failed', 'passed')
      and c.finished_at is not null
      and c.finished_at >= now() - interval '14 days'
  $plan$ into plan;
  if position('qa_candidates_vt_terminal_admission_idx' in plan::text) = 0 then
    raise exception 'Recent publishing admission scan must use qa_candidates_vt_terminal_admission_idx';
  end if;

  -- Budget and quota safety preserved
  if not exists (
    select 1 from public.qa_vt_metadata_rechecks
    where run_id = '200001' and state = 'escalated' and attempts = 6
  ) then
    raise exception 'Existing escalated budget was modified';
  end if;
  if exists (select 1 from public.qa_vt_requests) then
    raise exception 'Admission reserved provider quota';
  end if;
end;
$$;
rollback;
