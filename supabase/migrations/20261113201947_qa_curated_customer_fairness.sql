-- Alternate eligible customer work with curated verification under the existing claim lock.
alter table public.qa_pipeline_control add column last_dispatch_kind text
  check (last_dispatch_kind in ('ordinary','curated'));
CREATE OR REPLACE FUNCTION public.curated_verification_hold_valid(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case when jsonb_typeof(p) = 'object' then coalesce((jsonb_typeof(p) = 'object' and p->>'schemaVersion' = '1'
  and jsonb_typeof(p->'runId') = 'string' and p->>'runId' ~ '^[1-9][0-9]{0,19}$'
  and jsonb_typeof(p->'attempt') = 'number' and p->>'attempt' ~ '^[1-9][0-9]{0,8}$'
  and jsonb_typeof(p->'profileSha256') = 'string' and p->>'profileSha256' ~ '^[a-fA-F0-9]{64}$'
  and jsonb_typeof(p->'packagerCommit') = 'string' and p->>'packagerCommit' ~ '^[a-f0-9]{40}$'
  and jsonb_typeof(p->'definitionSha256') = 'string' and p->>'definitionSha256' ~ '^[a-f0-9]{64}$'
  and jsonb_typeof(p->'diagnosticsSha256') = 'string' and p->>'diagnosticsSha256' ~ '^[a-f0-9]{64}$'
  and jsonb_typeof(p->'reviewRef') = 'string' and p->>'reviewRef' like 'node:delegated-task:%'
  and length(p->>'reviewRef') between 21 and 2000
  and jsonb_typeof(p->'reason') = 'string' and length(btrim(p->>'reason')) between 1 and 600) or (p->>'schemaVersion' = '2'
  and (select count(*) from jsonb_object_keys(p)) = 7
  and p->>'holdType' = 'failed_config_requires_classification'
  and jsonb_typeof(p->'runId') = 'string' and p->>'runId' ~ '^[1-9][0-9]{0,19}$'
  and jsonb_typeof(p->'attempt') = 'number' and p->>'attempt' ~ '^[1-9][0-9]{0,8}$'
  and jsonb_typeof(p->'configVerificationId') = 'string'
  and p->>'configVerificationId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and p->>'conclusion' in ('failure','cancelled','timed_out','action_required','startup_failure','stale','neutral','skipped')
  and jsonb_typeof(p->'reason') = 'string' and length(btrim(p->>'reason')) between 1 and 600), false) else false end;
$function$;

alter table public.curated_verification_queue drop constraint curated_verification_queue_hold_check;
alter table public.curated_verification_queue add constraint curated_verification_queue_hold_check check (
 (hold is null or public.curated_verification_hold_valid(hold)) and (status <> 'held' or hold is not null)
 and (hold->>'schemaVersion' is distinct from '2'
   or (kind='config' and verification_key='config:'||(hold->>'configVerificationId'))));
CREATE OR REPLACE FUNCTION public.next_qa_curated_security_eligible()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  select to_jsonb(q) from public.curated_verification_queue q
  where status = 'queued' and not public.qa_curated_installer_security_held(inputs)
    and not exists (select 1 from public.curated_verification_queue h
        where h.status='held' and h.hold->>'schemaVersion'='2'
          and h.app_id=q.app_id and h.version=q.version)
  order by priority desc, enqueued_at, id limit 1;
$function$;
CREATE OR REPLACE FUNCTION public.claim_qa_work(p_kind text, p_id uuid, p_packager_commit text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  control public.qa_pipeline_control%rowtype;
  head record;
  claimed jsonb;
  ordinary_first boolean;
begin
  if p_kind is null or p_kind not in ('ordinary', 'curated') then raise exception 'Invalid QA queue'; end if;
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch', 0));
  select * into control from public.qa_pipeline_control where id = 'global';
  if not found or control.paused then return jsonb_build_object('reason', 'maintenance_paused'); end if;
  if control.required_packager_commit is distinct from p_packager_commit
     or control.scheduler_packager_commit is distinct from p_packager_commit
     or control.scheduler_seen_at is null
     or control.scheduler_seen_at < now() - interval '15 minutes' then
    return jsonb_build_object('reason', 'packager_release_pending');
  end if;
  if exists (select 1 from public.qa_candidates where status in ('dispatched', 'running'))
     or exists (select 1 from public.curated_verification_queue where status = 'dispatched') then
    return jsonb_build_object('reason', 'qa_active');
  end if;
  ordinary_first := coalesce(control.last_dispatch_kind='curated',false)
    and exists(select 1 from public.packaging_jobs where status='awaiting_qa' and archived_at is null);
  select * into head from (
    select c.id, 'ordinary'::text as kind, c.priority, c.enqueued_at,
      coalesce(not ((exists(select 1 from public.qa_package_blocks b
        where (b.winget_id,b.version,b.architecture,b.installer_sha256)=
              (c.winget_id,c.version,c.architecture,c.installer_sha256))
        or exists(select 1 from public.qa_retest_grants g where g.candidate_id=c.id))
        and not public.qa_retest_grant_eligible(c.id)),false) as boost_ok
      from public.qa_candidates c where status = 'queued' and test_level = 'psadt-package' and next_retry_at <= now()
        and not exists (select 1 from public.qa_installer_security_holds h where h.sha256 = lower(c.installer_sha256) and h.released_at is null)
    union all
    select q.id, 'curated'::text as kind, q.priority, q.enqueued_at, false as boost_ok
      from public.curated_verification_queue q where status = 'queued' and not public.qa_curated_installer_security_held(inputs)
      and not exists (select 1 from public.curated_verification_queue h
        where h.status='held' and h.hold->>'schemaVersion'='2'
          and h.app_id=q.app_id and h.version=q.version)
  ) pending order by
    (case when ordinary_first then case when kind='ordinary' and boost_ok then 2
      when kind='curated' then 1 else 0 end else 0 end) desc,
    priority desc, enqueued_at, kind, id limit 1;
  if not found then return jsonb_build_object('reason', 'queue_empty'); end if;
  if head.kind <> p_kind or head.id <> p_id then
    return jsonb_build_object('reason', 'higher_priority_work', 'queue', head.kind);
  end if;
  if p_kind = 'ordinary' then
    if (exists (select 1 from public.qa_candidates c join public.qa_package_blocks b
      on (b.winget_id,b.version,b.architecture,b.installer_sha256)
        = (c.winget_id,c.version,c.architecture,c.installer_sha256)
      where c.id=p_id) or exists (select 1 from public.qa_retest_grants where candidate_id=p_id))
      and not public.qa_retest_grant_eligible(p_id) then
      return jsonb_build_object('reason','package_compatibility_blocked');
    end if;
    update public.qa_candidates set status = 'dispatched', attempts = attempts + 1,
      dispatched_at = now(), phase = null, phase_started_at = null, phase_updated_at = null,
      failure_summary = null, updated_at = now()
      where id = p_id and status = 'queued' returning to_jsonb(qa_candidates.*) into claimed;
  else
    update public.curated_verification_queue set status = 'dispatched', dispatched_at = now(), updated_at = now()
      where id = p_id and status = 'queued' returning to_jsonb(curated_verification_queue.*) into claimed;
  end if;
  if claimed is not null then
    update public.qa_pipeline_control set last_dispatch_kind=p_kind where id='global';
  end if;
  return jsonb_build_object('row', claimed);
end;
$function$;
CREATE OR REPLACE FUNCTION public.enqueue_curated_verification(p_key text, p_app_id text, p_version text, p_kind text, p_inputs jsonb, p_supersede_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare queued jsonb; existing public.curated_verification_queue%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
 select * into existing from public.curated_verification_queue where verification_key=p_key for update;
 if found and existing.hold is not null then
  -- Never cancel active work. No supported release path can put a held key in
  -- flight; retaining metadata also fails closed after any future recovery.
  if existing.status='dispatched' then return null; end if;
  if existing.status<>'held' then
   update public.curated_verification_queue set status='held',finished_at=coalesce(finished_at,clock_timestamp()),
    updated_at=clock_timestamp() where id=existing.id;
  end if;
  return jsonb_build_object('held',true,'reason',case when existing.hold->>'schemaVersion'='2' then 'failed_config_requires_classification' else 'reviewed_no_go' end);
 end if;
 insert into public.curated_verification_queue(verification_key,app_id,version,kind,inputs)
  values(p_key,p_app_id,p_version,p_kind,p_inputs)
  on conflict(verification_key) do update set status='queued',inputs=excluded.inputs,github_run_id=null,
   dispatched_at=null,finished_at=null,enqueued_at=now(),updated_at=now()
   where curated_verification_queue.status in ('completed','superseded')
  returning to_jsonb(curated_verification_queue.*) into queued;
 if p_kind='release' then
  update public.curated_verification_queue set status='superseded',finished_at=now(),updated_at=now()
   where id=any(p_supersede_ids) and verification_key<>p_key and app_id=p_app_id and kind='release' and status='queued';
 end if;
 return queued;
end;
$function$;
