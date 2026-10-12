-- A diagnostic retest may collect exact lifecycle evidence without releasing
-- the quarantined payload. Every grant is exactly scoped and service-only.
create table public.qa_retest_grants (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.qa_candidates(id),
  repair_request_id uuid not null references public.qa_repair_requests(id),
  winget_id text not null,
  version text not null,
  architecture text not null check (architecture in ('x64','x86','arm64')),
  installer_sha256 text not null check (installer_sha256 ~ '^[A-F0-9]{64}$'),
  package_profile_sha256 text not null check (package_profile_sha256 ~ '^[A-F0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
create unique index qa_retest_grants_one_open on public.qa_retest_grants ((true)) where closed_at is null;
create index qa_retest_grants_candidate on public.qa_retest_grants(candidate_id);
alter table public.qa_retest_grants enable row level security;
revoke all on public.qa_retest_grants from public, anon, authenticated;
grant select, insert, update on public.qa_retest_grants to service_role;

create function public.qa_retest_grant_eligible(p_candidate_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.qa_candidates c
    join public.qa_retest_grants g on g.candidate_id = c.id
    join public.qa_repair_requests r on r.id = g.repair_request_id and r.candidate_id = c.id
    join public.qa_package_blocks b on b.winget_id = c.winget_id and b.version = c.version
      and b.architecture = c.architecture and b.installer_sha256 = c.installer_sha256
    where c.id = p_candidate_id and c.test_level = 'psadt-package'
      and g.closed_at is null and now() < g.expires_at
      and g.expires_at <= g.created_at + interval '24 hours'
      and (g.winget_id,g.version,g.architecture,g.installer_sha256,g.package_profile_sha256)
        = (c.winget_id,c.version,c.architecture,c.installer_sha256,c.package_profile_sha256)
      and b.block_code = 'failed_managed_lifecycle'
      and r.failure_class = 'app_lifecycle' and r.prior_requeues < 3 and r.status = 'requeued'
      and not exists (select 1 from public.package_eligibility_blocks e where lower(e.winget_id) = lower(c.winget_id))
      and not exists (select 1 from public.curated_excluded_apps e where lower(e.winget_id) = lower(c.winget_id))
      and not exists (select 1 from public.qa_package_results q where upper(q.installer_sha256) = c.installer_sha256
        and (q.virustotal_malicious > 0 or q.virustotal_suspicious > 0))
      and not exists (select 1 from public.qa_repair_requests s where lower(s.winget_id) = lower(c.winget_id)
        and s.failure_class = 'security')
      and not exists (select 1 from public.packaging_jobs j
        where j.status in ('awaiting_qa','queued','packaging') and (
          j.qa_candidate_id = c.id or (lower(j.winget_id) = lower(c.winget_id)
            and j.version = c.version and j.architecture = c.architecture
            and upper(j.installer_sha256) = c.installer_sha256)))
  );
$$;
revoke all on function public.qa_retest_grant_eligible(uuid) from public, anon, authenticated;
grant execute on function public.qa_retest_grant_eligible(uuid) to service_role;

-- Creation and requeue share the dispatch lock and retain fair queue ordering.
-- No customer job or quarantine is altered by this function.
create function public.create_qa_retest_grant(p_candidate_id uuid, p_expires_at timestamptz, p_reason text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare c public.qa_candidates%rowtype; r public.qa_repair_requests%rowtype; grant_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into c from public.qa_candidates where id=p_candidate_id for update;
  if not found or c.status not in ('failed','error','superseded') or c.phase = 'publishing'
    or coalesce(c.recovery_attempts,0) >= 5 then
    raise exception 'Candidate is not available for diagnostic retest';
  end if;
  select * into r from public.qa_repair_requests where candidate_id=c.id for update;
  if not found or r.status not in ('pending','in_progress') or r.failure_class <> 'app_lifecycle' or r.prior_requeues >= 3 then
    raise exception 'Repair is not eligible for diagnostic retest';
  end if;
  if not exists (select 1 from public.qa_pipeline_control control where id='global' and not paused
    and required_packager_commit = scheduler_packager_commit
    and scheduler_seen_at >= now()-interval '5 minutes'
    and required_packager_commit = ((c.test_config->>'packageProfileCanonicalJson')::jsonb)->'toolchain'->>'packagerCommit')
    or upper(encode(extensions.digest(c.test_config->>'packageProfileCanonicalJson','sha256'),'hex'))
       is distinct from c.package_profile_sha256 then
    raise exception 'Current exact package profile is required';
  end if;
  update public.qa_retest_grants set closed_at=now() where closed_at is null and expires_at <= now();
  insert into public.qa_retest_grants(candidate_id,repair_request_id,winget_id,version,architecture,
    installer_sha256,package_profile_sha256,expires_at,reason)
  values(c.id,r.id,c.winget_id,c.version,c.architecture,c.installer_sha256,c.package_profile_sha256,p_expires_at,p_reason)
  returning id into grant_id;
  update public.qa_repair_requests set status='requeued',updated_at=now(),resolution=null where id=r.id;
  if not public.qa_retest_grant_eligible(c.id) then raise exception 'Diagnostic retest guards rejected this tuple'; end if;
  update public.qa_candidates set status='queued',attempts=0,dispatched_at=null,started_at=null,finished_at=null,
    github_run_id=null,github_run_url=null,phase=null,phase_started_at=null,phase_updated_at=null,
    failure_summary=null,next_retry_at=now(),updated_at=now() where id=c.id;
  return grant_id;
end;
$$;
revoke all on function public.create_qa_retest_grant(uuid,timestamptz,text) from public, anon, authenticated;
grant execute on function public.create_qa_retest_grant(uuid,timestamptz,text) to service_role;

create function public.close_qa_retest_grant() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.status in ('passed','failed','superseded') or (new.status='error' and new.phase is distinct from 'publishing') then
    update public.qa_retest_grants set closed_at=now() where candidate_id=new.id and closed_at is null;
    if new.status not in ('passed','failed') and exists (
      select 1 from public.qa_retest_grants where candidate_id=new.id
    ) then
      update public.qa_repair_requests set status='in_progress',updated_at=now(),
        resolution='Diagnostic retest ended without a lifecycle outcome; repair remains open.'
        where candidate_id=new.id and status='requeued';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.close_qa_retest_grant() from public, anon, authenticated;
create trigger qa_retest_grant_terminal after update of status on public.qa_candidates
for each row when (old.status is distinct from new.status)
execute function public.close_qa_retest_grant();

-- Fail closed on an unrecognized deployed function. Preserve all existing
-- authentication, VM arbitration, pin, promotion and repair budget behavior.
do $migration$
declare
  claimant text := pg_get_functiondef('public.claim_qa_work(text,uuid,text)'::regprocedure);
  reporter text := pg_get_functiondef('public.report_qa_candidate_result(text,uuid,text,text)'::regprocedure);
  claim_anchor constant text := $old$if p_kind = 'ordinary' then$old$;
  promotion_anchor constant text := $old$if normalized_outcome = 'passed'
     and candidate.test_level = 'psadt-package'
     and candidate.test_config->>'profileKind' = 'catalog-default' then$old$;
begin
  if (length(claimant)-length(replace(claimant,claim_anchor,''))) <> length(claim_anchor)
    or (length(reporter)-length(replace(reporter,promotion_anchor,''))) <> length(promotion_anchor) then
    raise exception 'Unrecognized diagnostic retest function anchors';
  end if;
  execute replace(claimant,claim_anchor,$new$if p_kind = 'ordinary' then
    if (exists (select 1 from public.qa_candidates c join public.qa_package_blocks b
      on (b.winget_id,b.version,b.architecture,b.installer_sha256)
        = (c.winget_id,c.version,c.architecture,c.installer_sha256)
      where c.id=p_id) or exists (select 1 from public.qa_retest_grants where candidate_id=p_id))
      and not public.qa_retest_grant_eligible(p_id) then
      return jsonb_build_object('reason','package_compatibility_blocked');
    end if;$new$);
  reporter := replace(reporter,promotion_anchor,$new$if normalized_outcome = 'passed'
     and candidate.test_level = 'psadt-package'
     and candidate.test_config->>'profileKind' = 'catalog-default' then
    if exists (select 1 from public.qa_retest_grants where candidate_id=candidate.id) then
      update public.qa_candidates set failure_summary='Diagnostic retest passed; this version remains unavailable for deployment.',
        updated_at=now() where id=candidate.id;
      return true;
    end if;$new$);
  execute reporter;
end;
$migration$;
