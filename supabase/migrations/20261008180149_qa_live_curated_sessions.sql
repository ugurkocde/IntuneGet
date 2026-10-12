-- Telemetry mirrors an existing curated dispatch. It does not claim the VM,
-- publish results, or change a queue or approval.
create table public.qa_live_sessions (
 id uuid primary key default gen_random_uuid(),
 run_kind text not null default 'curated' check (run_kind = 'curated'),
 queue_id uuid not null references public.curated_verification_queue(id) on delete cascade,
 verification text not null check (verification in ('release','custom-settings')),
 app_id text not null check (app_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 version text not null check (version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$'),
 architecture text not null check (architecture in ('x64','x86','arm64')),
 upgrade_planned boolean not null,
 public_frames boolean not null,
 github_run_id bigint not null check (github_run_id > 0),
 github_run_attempt integer not null check (github_run_attempt between 1 and 100),
 state text not null default 'active' check (state in ('active','ended')),
 end_reason text check (end_reason in ('ended','superseded','dispatch_inactive','expired')),
 phase text check (phase in ('restoring_vm','inspecting_installer','preparing_package','testing_lifecycle','installing','detecting_install','uninstalling','verifying_removal','installing_previous','detecting_previous','upgrading','detecting_upgrade','final_uninstall','verifying_final_removal','cleaning_up')),
 phase_started_at timestamptz,
 started_at timestamptz not null default now(),
 heartbeat_at timestamptz not null default now(),
 ended_at timestamptz,
 frames_cleaned_at timestamptz,
 unique (github_run_id, github_run_attempt),
 check ((state = 'active' and ended_at is null and end_reason is null)
     or (state = 'ended' and ended_at is not null and end_reason is not null)),
 check (not public_frames or verification = 'release')
);
create unique index qa_live_sessions_single_active on public.qa_live_sessions ((true)) where state = 'active';
create index qa_live_sessions_queue on public.qa_live_sessions(queue_id);

create table public.qa_live_session_frames (
 session_id uuid primary key references public.qa_live_sessions(id) on delete cascade,
 -- Immutable sequence paths prevent a rejected old writer overwriting a live image.
 object_path text not null unique,
 sequence bigint not null check (sequence >= 0),
 captured_at timestamptz not null,
 width integer not null check (width between 64 and 1920),
 height integer not null check (height between 64 and 1200),
 byte_size integer not null check (byte_size between 4 and 204800),
 updated_at timestamptz not null default now(),
 check (object_path = 'sessions/' || session_id::text || '/frame-' || sequence::text || '.jpg')
);
alter table public.qa_live_sessions enable row level security;
alter table public.qa_live_session_frames enable row level security;
revoke all on public.qa_live_sessions, public.qa_live_session_frames from public, anon, authenticated;
grant select, insert, update, delete on public.qa_live_sessions, public.qa_live_session_frames to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('qa-live-session-frames','qa-live-session-frames',false,204800,array['image/jpeg']);

create function public.begin_qa_live_curated_session(
 p_app_id text, p_version text, p_architecture text, p_upgrade_planned boolean,
 p_host_custom_config boolean, p_run_id bigint, p_run_attempt integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 q public.curated_verification_queue%rowtype;
 s public.qa_live_sessions%rowtype;
 private boolean;
 ended_ids uuid[] := '{}';
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('intuneget-qa-dispatch',0));
 if p_run_id is null or p_run_id <= 0 or p_run_attempt is null or p_run_attempt not between 1 and 100
    or p_host_custom_config is null or p_upgrade_planned is null then
   return jsonb_build_object('status','refused');
 end if;
 select * into q from public.curated_verification_queue where status = 'dispatched';
 if not found or q.app_id is distinct from p_app_id or q.version is distinct from p_version
    or (q.github_run_id is not null and q.github_run_id::text <> p_run_id::text)
    or exists(select 1 from public.qa_candidates where status in ('dispatched','running')) then
   return jsonb_build_object('status','refused');
 end if;
 -- A workflow run observed under an earlier dispatch cannot own this dispatch,
 -- even when GitHub gives that old run a new attempt number.
 if exists(select 1 from public.qa_live_sessions prior
     where prior.github_run_id = p_run_id and prior.queue_id = q.id
       and prior.started_at < q.dispatched_at) then
   return jsonb_build_object('status','refused');
 end if;
 private := q.kind is distinct from 'release' or p_host_custom_config
     or coalesce(jsonb_typeof(q.inputs), '') <> 'object';
 if not private then
   private := exists(select 1 from jsonb_object_keys(q.inputs) k where k ~* 'psadt|config');
 end if;
 -- A previously ended attempt never becomes active again.
 select * into s from public.qa_live_sessions where github_run_id = p_run_id and github_run_attempt = p_run_attempt;
 if found then
   if s.state <> 'active' or s.queue_id <> q.id or s.app_id <> p_app_id or s.version <> p_version
      or s.architecture <> p_architecture or s.started_at <= now() - interval '4 hours'
      or s.started_at < q.dispatched_at then
     return jsonb_build_object('status','refused');
   end if;
   update public.qa_live_sessions set public_frames = public_frames and not private,
       verification = case when private or not public_frames then 'custom-settings' else verification end,
       heartbeat_at = now() where id = s.id returning * into s;
   return jsonb_build_object('status','resumed','sessionId',s.id,'publicFrames',s.public_frames,'endedSessionIds',ended_ids);
 end if;
 select * into s from public.qa_live_sessions where state = 'active';
 if found then
   if s.queue_id = q.id and (s.started_at < q.dispatched_at
       or (q.github_run_id is not null and q.github_run_id <> s.github_run_id::text)) then
     -- The row was dispatched again. Only the queue's own dispatch time or run id
     -- retires the old session; heartbeat age never transfers ownership.
     update public.qa_live_sessions set state='ended',end_reason='dispatch_inactive',ended_at=now() where id=s.id;
   elsif s.queue_id = q.id then
     if s.github_run_id <> p_run_id or s.github_run_attempt >= p_run_attempt then
       return jsonb_build_object('status','refused');
     end if;
     update public.qa_live_sessions set state='ended',end_reason='superseded',ended_at=now() where id=s.id;
   else
     if exists(select 1 from public.curated_verification_queue where id=s.queue_id and status='dispatched') then
       return jsonb_build_object('status','refused');
     end if;
     update public.qa_live_sessions set state='ended',end_reason='dispatch_inactive',ended_at=now() where id=s.id;
   end if;
   ended_ids := array[s.id];
 end if;
 insert into public.qa_live_sessions(queue_id,verification,app_id,version,architecture,upgrade_planned,public_frames,github_run_id,github_run_attempt)
 values(q.id,case when private then 'custom-settings' else 'release' end,p_app_id,p_version,p_architecture,p_upgrade_planned,not private,p_run_id,p_run_attempt)
 returning * into s;
 return jsonb_build_object('status','started','sessionId',s.id,'publicFrames',s.public_frames,'endedSessionIds',ended_ids);
end $$;

-- Called by the existing live-frame cleanup cron. Heartbeat age alone does
-- not retire an owner: a slow or interrupted publisher cannot transfer a VM.
create function public.expire_qa_live_curated_sessions()
 returns integer language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('intuneget-qa-dispatch',0));
 update public.qa_live_sessions s set state='ended',ended_at=now(),
   end_reason=case when s.started_at <= now()-interval '4 hours' then 'expired' else 'dispatch_inactive' end
 where s.state='active' and (s.started_at <= now()-interval '4 hours' or not exists(
   select 1 from public.curated_verification_queue q where q.id=s.queue_id and q.status='dispatched'
     and q.app_id=s.app_id and q.version=s.version and s.started_at >= coalesce(q.dispatched_at,s.started_at)
     and (q.github_run_id is null or q.github_run_id=s.github_run_id::text)));
 get diagnostics affected = row_count;
 return affected;
end $$;
revoke all on function public.expire_qa_live_curated_sessions() from public, anon, authenticated;
grant execute on function public.expire_qa_live_curated_sessions() to service_role;

create function public.publish_qa_live_curated_phase(p_session_id uuid,p_run_id bigint,p_run_attempt integer,p_phase text,p_observed_at timestamptz)
 returns boolean language plpgsql security invoker set search_path = '' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('intuneget-qa-dispatch',0));
 if p_phase is null or p_phase not in ('restoring_vm','inspecting_installer','preparing_package','testing_lifecycle','installing','detecting_install','uninstalling','verifying_removal','installing_previous','detecting_previous','upgrading','detecting_upgrade','final_uninstall','verifying_final_removal','cleaning_up')
    or p_observed_at is null or p_observed_at < now()-interval '2 minutes' or p_observed_at > now()+interval '2 minutes' then return false; end if;
 update public.qa_live_sessions s set
   phase_started_at=case when s.phase is distinct from p_phase then p_observed_at else s.phase_started_at end,
   phase=p_phase,heartbeat_at=now()
 where s.id=p_session_id and s.github_run_id=p_run_id and s.github_run_attempt=p_run_attempt and s.state='active'
   and s.started_at > now()-interval '4 hours' and p_observed_at >= coalesce(s.phase_started_at,s.started_at)
   and exists(select 1 from public.curated_verification_queue q where q.id=s.queue_id and q.status='dispatched' and q.app_id=s.app_id and q.version=s.version
     and s.started_at >= coalesce(q.dispatched_at,s.started_at) and (q.github_run_id is null or q.github_run_id=s.github_run_id::text));
 return found;
end $$;

create function public.authorize_qa_live_curated_frame(p_session_id uuid,p_run_id bigint,p_run_attempt integer,p_captured_at timestamptz)
 returns boolean language sql security invoker set search_path = '' as $$
 select exists(select 1 from public.qa_live_sessions s join public.curated_verification_queue q on q.id=s.queue_id
 where s.id=p_session_id and s.github_run_id=p_run_id and s.github_run_attempt=p_run_attempt
 and s.state='active' and s.public_frames and s.verification='release' and q.status='dispatched'
 and q.app_id=s.app_id and q.version=s.version and q.kind='release' and jsonb_typeof(q.inputs)='object'
 and s.started_at >= coalesce(q.dispatched_at,s.started_at) and (q.github_run_id is null or q.github_run_id=s.github_run_id::text)
 and not exists(select 1 from jsonb_object_keys(case when jsonb_typeof(q.inputs)='object' then q.inputs else '{}'::jsonb end) k where k ~* 'psadt|config')
 and s.started_at > now()-interval '4 hours' and p_captured_at >= s.started_at
 and p_captured_at between now()-interval '2 minutes' and now()+interval '2 minutes');
$$;

create function public.publish_qa_live_curated_frame_metadata(p_session_id uuid,p_run_id bigint,p_run_attempt integer,
 p_object_path text,p_sequence bigint,p_captured_at timestamptz,p_width integer,p_height integer,p_byte_size integer)
 returns boolean language plpgsql security invoker set search_path = '' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('intuneget-qa-dispatch',0));
 if not public.authorize_qa_live_curated_frame(p_session_id,p_run_id,p_run_attempt,p_captured_at) then return false; end if;
 insert into public.qa_live_session_frames(session_id,object_path,sequence,captured_at,width,height,byte_size)
 values(p_session_id,p_object_path,p_sequence,p_captured_at,p_width,p_height,p_byte_size)
 on conflict(session_id) do update set object_path=excluded.object_path,sequence=excluded.sequence,
 captured_at=excluded.captured_at,width=excluded.width,height=excluded.height,byte_size=excluded.byte_size,updated_at=now()
 where excluded.sequence > public.qa_live_session_frames.sequence and excluded.captured_at >= public.qa_live_session_frames.captured_at;
 if not found then return false; end if;
 update public.qa_live_sessions set heartbeat_at=now() where id=p_session_id;
 return true;
end $$;

create function public.end_qa_live_curated_session(p_session_id uuid,p_run_id bigint,p_run_attempt integer)
 returns jsonb language plpgsql security invoker set search_path = '' as $$
declare paths text[];
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('intuneget-qa-dispatch',0));
 if not exists(select 1 from public.qa_live_sessions where id=p_session_id and github_run_id=p_run_id and github_run_attempt=p_run_attempt) then
   return jsonb_build_object('status','refused');
 end if;
 update public.qa_live_sessions set state='ended',end_reason='ended',ended_at=now()
 where id=p_session_id and state='active';
 select coalesce(array_agg(object_path),'{}') into paths from public.qa_live_session_frames where session_id=p_session_id;
 delete from public.qa_live_session_frames where session_id=p_session_id;
 return jsonb_build_object('status','ended','objectPaths',paths);
end $$;

revoke all on function public.begin_qa_live_curated_session(text,text,text,boolean,boolean,bigint,integer),
 public.publish_qa_live_curated_phase(uuid,bigint,integer,text,timestamptz),
 public.authorize_qa_live_curated_frame(uuid,bigint,integer,timestamptz),
 public.publish_qa_live_curated_frame_metadata(uuid,bigint,integer,text,bigint,timestamptz,integer,integer,integer),
 public.end_qa_live_curated_session(uuid,bigint,integer) from public, anon, authenticated;
grant execute on function public.begin_qa_live_curated_session(text,text,text,boolean,boolean,bigint,integer),
 public.publish_qa_live_curated_phase(uuid,bigint,integer,text,timestamptz),
 public.authorize_qa_live_curated_frame(uuid,bigint,integer,timestamptz),
 public.publish_qa_live_curated_frame_metadata(uuid,bigint,integer,text,bigint,timestamptz,integer,integer,integer),
 public.end_qa_live_curated_session(uuid,bigint,integer) to service_role;
