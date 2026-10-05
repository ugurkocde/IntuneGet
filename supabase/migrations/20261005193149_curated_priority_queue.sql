-- Curated discovery persists intent instead of building a GitHub FIFO backlog.
-- Both dispatchers claim through the same transaction lock; the VM's existing
-- workflow concurrency group remains the final host isolation boundary.
create table public.curated_verification_queue (
  id uuid primary key default gen_random_uuid(),
  verification_key text not null unique,
  app_id text not null,
  version text not null,
  kind text not null check (kind in ('release', 'config')),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  priority integer not null default 2000,
  status text not null default 'queued' check (status in ('queued', 'dispatched', 'completed', 'superseded')),
  enqueued_at timestamptz not null default now(),
  dispatched_at timestamptz,
  finished_at timestamptz,
  github_run_id text,
  updated_at timestamptz not null default now()
);
create index curated_verification_queue_dispatch_idx
  on public.curated_verification_queue(priority desc, enqueued_at, id) where status = 'queued';
create unique index curated_verification_queue_single_active_idx
  on public.curated_verification_queue ((true)) where status = 'dispatched';
alter table public.curated_verification_queue enable row level security;
revoke all on public.curated_verification_queue from public, anon, authenticated;
grant select, insert, update, delete on public.curated_verification_queue to service_role;

create function public.enqueue_curated_verification(p_key text, p_app_id text, p_version text,
  p_kind text, p_inputs jsonb, p_supersede_ids uuid[] default '{}')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare queued jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch', 0));
  insert into public.curated_verification_queue(verification_key, app_id, version, kind, inputs)
    values (p_key, p_app_id, p_version, p_kind, p_inputs)
    on conflict (verification_key) do update set
      status = 'queued', inputs = excluded.inputs, github_run_id = null,
      dispatched_at = null, finished_at = null, enqueued_at = now(), updated_at = now()
      where curated_verification_queue.status in ('completed', 'superseded')
    returning to_jsonb(curated_verification_queue.*) into queued;
  -- Caller supplies only older discoveries for this app. The transaction and
  -- queued guard preserve running work and every unrelated application.
  if p_kind = 'release' then
    update public.curated_verification_queue set status = 'superseded', finished_at = now(), updated_at = now()
      where id = any(p_supersede_ids) and verification_key <> p_key
        and app_id = p_app_id and kind = 'release' and status = 'queued';
  end if;
  return queued;
end;
$$;
revoke all on function public.enqueue_curated_verification(text, text, text, text, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.enqueue_curated_verification(text, text, text, text, jsonb, uuid[]) to service_role;

-- Only trusted server callers can claim work. A single urgent FIFO includes
-- customer uploads, auto-updates and curated releases; lower priorities follow.
create function public.claim_qa_work(p_kind text, p_id uuid, p_packager_commit text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  control public.qa_pipeline_control%rowtype;
  head record;
  claimed jsonb;
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
  select * into head from (
    select id, 'ordinary'::text as kind, priority, enqueued_at
      from public.qa_candidates where status = 'queued' and test_level = 'psadt-package' and next_retry_at <= now()
    union all
    select id, 'curated'::text as kind, priority, enqueued_at
      from public.curated_verification_queue where status = 'queued'
  ) pending order by priority desc, enqueued_at, kind, id limit 1;
  if not found then return jsonb_build_object('reason', 'queue_empty'); end if;
  if head.kind <> p_kind or head.id <> p_id then
    return jsonb_build_object('reason', 'higher_priority_work', 'queue', head.kind);
  end if;
  if p_kind = 'ordinary' then
    update public.qa_candidates set status = 'dispatched', attempts = attempts + 1,
      dispatched_at = now(), phase = null, phase_started_at = null, phase_updated_at = null,
      failure_summary = null, updated_at = now()
      where id = p_id and status = 'queued' returning to_jsonb(qa_candidates.*) into claimed;
  else
    update public.curated_verification_queue set status = 'dispatched', dispatched_at = now(), updated_at = now()
      where id = p_id and status = 'queued' returning to_jsonb(curated_verification_queue.*) into claimed;
  end if;
  return jsonb_build_object('row', claimed);
end;
$$;
revoke all on function public.claim_qa_work(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_qa_work(text, uuid, text) to service_role;

-- Preserve existing pending uploads; promote only auto-update requests.
update public.qa_candidates set priority = 2000, updated_at = now()
  where status = 'queued' and demand_source = 'auto_update' and priority < 2000;
