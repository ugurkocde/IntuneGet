-- Preparatory, write-once provenance for a single dependency-verification run.
-- Reservation does not queue, dispatch, bind a run, admit a result, or lift a hold.
create table public.qa_vcpp_retest_authorizations (
  candidate_id uuid primary key references public.qa_candidates(id),
  winget_id text not null,
  version text not null,
  architecture text not null check (architecture in ('x86','x64','arm64')),
  installer_sha256 text not null check (installer_sha256 ~ '^[A-F0-9]{64}$' and installer_sha256<>repeat('0',64)),
  profile_sha256 text not null check (profile_sha256 ~ '^[A-F0-9]{64}$' and profile_sha256<>repeat('0',64)),
  packager_commit text not null check (packager_commit ~ '^[a-f0-9]{40}$'),
  dependency_sha256 text not null check (dependency_sha256 ~ '^[A-F0-9]{64}$' and dependency_sha256<>repeat('0',64)),
  original_pr integer not null check (original_pr>0),
  original_head text not null check (original_head ~ '^[a-f0-9]{40}$'),
  original_run_id text not null check (original_run_id ~ '^[1-9][0-9]*$'),
  original_state jsonb not null check (jsonb_typeof(original_state)='object'),
  manifest_commit text not null check (manifest_commit ~ '^[a-f0-9]{40}$'),
  manifest_blob text not null check (manifest_blob ~ '^[a-f0-9]{40}$'),
  review_sha256 text not null check (review_sha256 ~ '^[a-f0-9]{64}$'),
  -- Database login only (usually PostgREST authenticator), not a human identity.
  created_by_login text not null default session_user,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  state text not null default 'reserved' check (state in
    ('reserved','dispatch_pending','dispatch_unknown','bound','passed','failed','superseded','voided_customer','expired')),
  run_id text check (run_id ~ '^[1-9][0-9]*$'),
  run_attempt integer check (run_attempt=1),
  bound_at timestamptz,
  check (expires_at>created_at and expires_at<=created_at+interval '24 hours'),
  check ((run_id is null and run_attempt is null and bound_at is null)
    or (run_id is not null and run_attempt=1 and bound_at is not null and bound_at>=created_at and bound_at<=expires_at)),
  check (state not in ('bound','passed') or run_id is not null),
  unique(winget_id,version,architecture,installer_sha256,profile_sha256,packager_commit,dependency_sha256)
);
alter table public.qa_vcpp_retest_authorizations enable row level security;
revoke all on public.qa_vcpp_retest_authorizations from public,anon,authenticated,service_role;
grant select on public.qa_vcpp_retest_authorizations to service_role;

create unique index qa_vcpp_retest_one_run on public.qa_vcpp_retest_authorizations(run_id)
  where run_id is not null;

-- Enforce identity and monotonicity before any transition API is introduced.
create function public.guard_qa_vcpp_retest_authorization() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'VC++ authorization history cannot be deleted';end if;
  if to_jsonb(new)=to_jsonb(old) then return new;end if;
  if (to_jsonb(new)-array['state','run_id','run_attempt','bound_at'])
    is distinct from (to_jsonb(old)-array['state','run_id','run_attempt','bound_at']) then
    raise exception 'VC++ authorization identity and provenance are immutable';
  end if;
  if not ((old.state='reserved' and new.state in ('dispatch_pending','superseded','voided_customer','expired'))
    or (old.state='dispatch_pending' and new.state in ('bound','dispatch_unknown','failed','superseded','voided_customer','expired'))
    or (old.state='dispatch_unknown' and new.state in ('bound','failed','superseded','expired'))
    or (old.state='bound' and new.state in ('passed','failed','superseded'))) then
    raise exception 'Invalid VC++ authorization state transition';
  end if;
  if (new.run_id,new.run_attempt,new.bound_at) is distinct from (old.run_id,old.run_attempt,old.bound_at) then
    if old.run_id is not null or old.state not in ('dispatch_pending','dispatch_unknown')
      or new.state<>'bound' or new.run_id is null or new.run_attempt is distinct from 1
      or new.bound_at is null or clock_timestamp()>old.expires_at
      or new.bound_at>clock_timestamp() or new.bound_at<clock_timestamp()-interval '1 minute' then
      raise exception 'VC++ run binding is write once, current and attempt one';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_qa_vcpp_retest_authorization() from public,anon,authenticated,service_role;
create trigger qa_vcpp_retest_history_guard before update or delete on public.qa_vcpp_retest_authorizations
  for each row execute function public.guard_qa_vcpp_retest_authorization();

-- Same existing QA-owner service_role administrative path as repair adoption.
-- The host synchronization secret receives no authorization-creation capability.
create function public.reserve_qa_vcpp_retest(p_candidate_id uuid,p_original_pr integer,
  p_original_head text,p_manifest_commit text,p_manifest_blob text,p_review_sha256 text,
  p_expires_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.qa_candidates%rowtype; canonical jsonb; dep jsonb;
  stamp timestamptz:=clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into c from public.qa_candidates where id=p_candidate_id for update;
  if not found or c.status is distinct from 'error' or c.phase is distinct from 'publishing'
    or c.test_level is distinct from 'psadt-package' or c.finished_at is null
    or c.github_run_id is null or c.github_run_id !~ '^[1-9][0-9]*$'
    or c.test_config->>'profileKind' is distinct from 'catalog-default'
    or c.package_profile_sha256 is null or c.package_profile_sha256 !~ '^[A-F0-9]{64}$'
    or c.installer_sha256 is null or c.installer_sha256 !~ '^[A-Fa-f0-9]{64}$'
    or c.test_config->>'packageProfileCanonicalJson' is null
    or upper(encode(extensions.digest(c.test_config->>'packageProfileCanonicalJson','sha256'),'hex'))
      is distinct from c.package_profile_sha256
    or p_expires_at is null or p_expires_at<=stamp or p_expires_at>stamp+interval '24 hours'
    or exists(select 1 from public.packaging_jobs j where j.status in ('awaiting_qa','queued','packaging','qa_failed')
      and (j.qa_candidate_id=c.id or (lower(j.winget_id)=lower(c.winget_id)
        and j.version=c.version and lower(j.architecture)=lower(c.architecture)
        and upper(j.installer_sha256)=upper(c.installer_sha256))))
    or exists(select 1 from public.qa_package_results q where q.package_profile_sha256=c.package_profile_sha256)
    or exists(select 1 from public.qa_candidates a where a.id<>c.id and a.status in ('queued','dispatched','running')
      and lower(a.winget_id)=lower(c.winget_id) and a.version=c.version and a.architecture=c.architecture
      and upper(a.installer_sha256)=upper(c.installer_sha256)
      and a.package_profile_sha256=c.package_profile_sha256)
    or exists(select 1 from public.qa_candidates n where lower(n.winget_id)=lower(c.winget_id)
      and n.architecture=c.architecture and n.status<>'superseded' and n.enqueued_at>c.enqueued_at) then
    raise exception 'VC++ retest candidate is not reservable';
  end if;
  canonical:=(c.test_config->>'packageProfileCanonicalJson')::jsonb;
  if canonical#>>'{app,wingetId}' is distinct from c.winget_id
    or canonical#>>'{app,version}' is distinct from c.version
    or canonical#>>'{app,architecture}' is distinct from c.architecture
    or upper(canonical#>>'{installer,sha256}') is distinct from upper(c.installer_sha256)
    or jsonb_typeof(canonical#>'{installer,packageDependencies}') is distinct from 'array'
    or jsonb_array_length(canonical#>'{installer,packageDependencies}')<>1 then
    raise exception 'Exact canonical VC++ profile is required';
  end if;
  dep:=canonical#>'{installer,packageDependencies,0}';
  if dep->>'packageIdentifier' is distinct from 'Microsoft.VCRedist.2015+.'||c.architecture
    or dep->>'architecture' is distinct from c.architecture or dep->'order' is distinct from '1'::jsonb
    or dep->>'sha256' is null or dep->>'sha256' !~ '^[A-F0-9]{64}$'
    or dep->>'sha256'=repeat('0',64) or dep->>'sha256'=upper(c.installer_sha256)
    or not exists(select 1 from public.qa_pipeline_control x where x.id='global' and not x.paused
      and x.required_packager_commit=canonical#>>'{toolchain,packagerCommit}'
      and x.scheduler_packager_commit=x.required_packager_commit
      and x.scheduler_seen_at>=stamp-interval '5 minutes') then
    raise exception 'Canonical VC++ dependency and current packager pin are required';
  end if;
  insert into public.qa_vcpp_retest_authorizations(candidate_id,winget_id,version,architecture,
    installer_sha256,profile_sha256,packager_commit,dependency_sha256,original_pr,original_head,
    original_run_id,original_state,manifest_commit,manifest_blob,review_sha256,created_at,expires_at)
  values(c.id,lower(c.winget_id),c.version,c.architecture,upper(c.installer_sha256),c.package_profile_sha256,
    canonical#>>'{toolchain,packagerCommit}',dep->>'sha256',p_original_pr,p_original_head,c.github_run_id,
    jsonb_build_object('status',c.status,'phase',c.phase,'runId',c.github_run_id,'finishedAt',c.finished_at,
      'demandSource',c.demand_source),
    p_manifest_commit,p_manifest_blob,p_review_sha256,stamp,p_expires_at);
  return c.id;
end;
$$;
revoke all on function public.reserve_qa_vcpp_retest(uuid,integer,text,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.reserve_qa_vcpp_retest(uuid,integer,text,text,text,text,timestamptz) to service_role;

-- No runtime transition is installed by this preparatory migration. Every row
-- remains reserved until the separately reviewed fair-queue activation exists.
