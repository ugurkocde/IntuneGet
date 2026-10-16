-- A reviewed lifecycle NO_GO is distinct from security and catalog approval.
-- Holds are deliberately sticky for this release key. No automatic release or
-- same-tuple hypothesis retry is implemented here; that needs separate review.
create function public.curated_verification_hold_valid(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
 select coalesce(jsonb_typeof(p) = 'object' and p->>'schemaVersion' = '1'
  and jsonb_typeof(p->'runId') = 'string' and p->>'runId' ~ '^[1-9][0-9]{0,19}$'
  and jsonb_typeof(p->'attempt') = 'number' and p->>'attempt' ~ '^[1-9][0-9]{0,8}$'
  and jsonb_typeof(p->'profileSha256') = 'string' and p->>'profileSha256' ~ '^[a-fA-F0-9]{64}$'
  and jsonb_typeof(p->'packagerCommit') = 'string' and p->>'packagerCommit' ~ '^[a-f0-9]{40}$'
  and jsonb_typeof(p->'definitionSha256') = 'string' and p->>'definitionSha256' ~ '^[a-f0-9]{64}$'
  and jsonb_typeof(p->'diagnosticsSha256') = 'string' and p->>'diagnosticsSha256' ~ '^[a-f0-9]{64}$'
  and jsonb_typeof(p->'reviewRef') = 'string' and p->>'reviewRef' like 'node:delegated-task:%'
  and length(p->>'reviewRef') between 21 and 2000
  and jsonb_typeof(p->'reason') = 'string' and length(btrim(p->>'reason')) between 1 and 600, false);
$$;
revoke all on function public.curated_verification_hold_valid(jsonb) from public, anon, authenticated;
grant execute on function public.curated_verification_hold_valid(jsonb) to service_role;

alter table public.curated_verification_queue add column hold jsonb;
alter table public.curated_verification_queue drop constraint curated_verification_queue_status_check;
alter table public.curated_verification_queue add constraint curated_verification_queue_status_check
 check (status in ('queued','dispatched','completed','superseded','held'));
alter table public.curated_verification_queue add constraint curated_verification_queue_hold_check
 check ((hold is null or public.curated_verification_hold_valid(hold)) and (status <> 'held' or hold is not null));

create function public.hold_curated_verification(p_key text, p_expected_updated_at timestamptz, p_hold jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare q public.curated_verification_queue%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
 if not public.curated_verification_hold_valid(p_hold) then raise exception 'Invalid hold metadata'; end if;
 select * into q from public.curated_verification_queue where verification_key=p_key for update;
 if not found then raise exception 'Curated queue key missing'; end if;
 if q.status='held' and q.hold=p_hold then return to_jsonb(q); end if;
 if q.hold is not null then raise exception 'Existing hold cannot be overwritten'; end if;
 if q.status not in ('queued','completed') then raise exception 'Candidate unavailable or dispatched'; end if;
 if q.updated_at is distinct from p_expected_updated_at then raise exception 'Curated queue row changed'; end if;
 if not exists(select 1 from public.curated_qa_runs h where h.github_run_id=p_hold->>'runId'
  and h.kind='release' and h.config_verification_id is null
  and h.github_run_attempt=(p_hold->>'attempt')::integer
  and not exists(select 1 from public.curated_qa_runs newer where newer.github_run_id=h.github_run_id and newer.github_run_attempt>h.github_run_attempt)
  and h.outcome='Failed' and h.app_id=q.app_id and h.tested_version=q.version
  and q.kind='release' and q.verification_key='release:'||h.candidate_id
  and lower(h.package_profile_sha256)=lower(p_hold->>'profileSha256')
  and h.packager_commit=p_hold->>'packagerCommit') then raise exception 'Exact failed lifecycle evidence missing'; end if;
 update public.curated_verification_queue set status='held',hold=p_hold,
  finished_at=coalesce(finished_at,clock_timestamp()),updated_at=clock_timestamp()
  where id=q.id returning * into q;
 return to_jsonb(q);
end;
$$;
revoke all on function public.hold_curated_verification(text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.hold_curated_verification(text,timestamptz,jsonb) to service_role;

create or replace function public.enqueue_curated_verification(p_key text,p_app_id text,p_version text,
 p_kind text,p_inputs jsonb,p_supersede_ids uuid[] default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
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
  return jsonb_build_object('held',true,'reason','reviewed_no_go');
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
$$;
