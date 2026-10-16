-- Coverage holds are exclusion records, never clean reputation evidence.
-- Zero means awaiting engine coverage; existing positive verdicts and grants
-- are preserved. Public artifact submission and quota callers activate later.
-- Serial reservations are spent before an external request and never refunded
-- after a timeout or ambiguous response. Cache hits do not call this API.
create table public.qa_vt_requests (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$' and sha256 <> repeat('0',64)),
  operation text not null check (operation in ('hash_lookup','upload_url','upload','analysis_lookup')),
  reserved_at timestamptz not null default now()
);
create index qa_vt_requests_reserved_at_idx on public.qa_vt_requests(reserved_at);
create table public.qa_vt_request_budget (
  id boolean primary key default true check (id),
  blocked_until timestamptz
);
insert into public.qa_vt_request_budget(id) values(true);
alter table public.qa_vt_requests enable row level security;
alter table public.qa_vt_request_budget enable row level security;
revoke all on public.qa_vt_requests,public.qa_vt_request_budget from public,anon,authenticated;
grant select,insert on public.qa_vt_requests to service_role;
grant select,update on public.qa_vt_request_budget to service_role;

create function public.reserve_qa_vt_request(p_sha256 text,p_operation text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare stamp timestamptz; blocked timestamptz; minute_count integer;
  day_count integer; minute_first timestamptz; day_first timestamptz; reservation uuid;
begin
  if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_sha256 = repeat('0',64)
     or p_operation is null or p_operation not in ('hash_lookup','upload_url','upload','analysis_lookup') then
    raise exception 'Invalid VirusTotal request reservation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('intuneget-vt-request-budget',0));
  stamp := clock_timestamp();
  select blocked_until into blocked from public.qa_vt_request_budget where id=true;
  if not found then raise exception 'VirusTotal request budget unavailable'; end if;
  select count(*),min(reserved_at) into day_count,day_first from public.qa_vt_requests
    where reserved_at > stamp - interval '24 hours';
  select count(*),min(reserved_at) into minute_count,minute_first from public.qa_vt_requests
    where reserved_at > stamp - interval '60 seconds';
  if minute_count >= 4 then blocked := greatest(blocked,minute_first+interval '60 seconds'); end if;
  if day_count >= 450 then blocked := greatest(blocked,day_first+interval '24 hours'); end if;
  if blocked > stamp then return jsonb_build_object('reservationId',null,'retryAt',blocked); end if;
  insert into public.qa_vt_requests(sha256,operation,reserved_at) values(p_sha256,p_operation,stamp)
    returning id into reservation;
  return jsonb_build_object('reservationId',reservation,'retryAt',null);
end;
$$;
revoke all on function public.reserve_qa_vt_request(text,text) from public,anon,authenticated;
grant execute on function public.reserve_qa_vt_request(text,text) to service_role;

create function public.defer_qa_vt_requests(p_reservation uuid,p_retry_after_seconds integer) returns void
language plpgsql security invoker set search_path = '' as $$
declare stamp timestamptz;
begin
  if p_retry_after_seconds is null or p_retry_after_seconds < 1 or p_retry_after_seconds > 604800 then
    raise exception 'Invalid VirusTotal Retry-After';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('intuneget-vt-request-budget',0));
  stamp := clock_timestamp();
  if not exists(select 1 from public.qa_vt_requests where id=p_reservation
    and reserved_at between stamp-interval '10 minutes' and stamp) then
    raise exception 'VirusTotal request reservation unavailable';
  end if;
  update public.qa_vt_request_budget set blocked_until=greatest(blocked_until,
    stamp+make_interval(secs=>p_retry_after_seconds)) where id=true;
  if not found then raise exception 'VirusTotal request budget unavailable'; end if;
end;
$$;
revoke all on function public.defer_qa_vt_requests(uuid,integer) from public,anon,authenticated;
grant execute on function public.defer_qa_vt_requests(uuid,integer) to service_role;

alter table public.qa_installer_security_holds
  drop constraint qa_installer_security_holds_malicious_verdicts_check,
  add constraint qa_installer_security_holds_malicious_verdicts_check
    check (malicious_verdicts between 0 and 9999);
alter table public.qa_installer_security_holds alter column reason set expression as (
  case when malicious_verdicts = 0 then 'VirusTotal: awaiting engine coverage, rechecking daily'
       when malicious_verdicts = 1 then 'VirusTotal: 1 engine flagged, rechecking daily'
       else 'VirusTotal refused execution for this installer hash.' end
);

-- Extend the existing authenticated reporter's trigger without replacing its
-- authentication, terminal reporting, retry budget or dispatch locking.
do $migration$
declare original text; definition text; anchor text;
begin
  original := pg_get_functiondef('public.guard_qa_installer_security()'::regprocedure);
  original := replace(original,E'\r\n',E'\n');
  anchor := E'begin\n  -- This exact summary';
  if length(original)-length(replace(original,anchor,'')) <> length(anchor) then
    raise exception 'QA coverage reporter guard anchor changed';
  end if;
  definition := replace(original, anchor, $guard$begin
  if tg_op = 'UPDATE' and old.status in ('dispatched','running')
     and new.status = 'error' and new.test_level = 'psadt-package'
     and new.failure_summary = 'VirusTotal: awaiting engine coverage, rechecking daily'
     and new.installer_sha256 ~ '^[A-Fa-f0-9]{64}$'
     and lower(new.installer_sha256) <> repeat('0',64) then
    insert into public.qa_installer_security_holds(sha256,malicious_verdicts)
      values(lower(new.installer_sha256),0)
    on conflict(sha256) do update set
      malicious_verdicts = 0, released_at = null, verdict_at = now(),
      first_held_at = case when qa_installer_security_holds.released_at is null
        then qa_installer_security_holds.first_held_at else now() end,
      next_check_at = greatest(qa_installer_security_holds.next_check_at,now()+interval '24 hours'),
      checked_at = null, recheck_lease = null, recheck_lease_expires_at = null
    -- An unknown report must never replace an active positive verdict.
    where qa_installer_security_holds.malicious_verdicts = 0
       or qa_installer_security_holds.released_at is not null;
  end if;
  -- This exact summary$guard$);
  anchor := '''VirusTotal: 1 engine flagged, rechecking daily'',''VirusTotal refused execution for this installer hash.''';
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'QA coverage waiting reason anchor changed';
  end if;
  definition := replace(definition,anchor,anchor || ',''VirusTotal: awaiting engine coverage, rechecking daily''');
  execute definition;
end;
$migration$;

-- A hold still has no time-based release. Only the existing newer covered
-- verdict path may requeue this exact security reason; unrelated errors,
-- package blocks, repair budgets and historical lifecycle records remain.
do $migration$
declare signature text; original text; definition text; anchor text;
begin
  foreach signature in array array[
    'public.refresh_qa_installer_security_holds()',
    'public.complete_qa_installer_security_recheck(text,text,uuid,integer,integer,integer,timestamptz)'
  ] loop
    original := pg_get_functiondef(signature::regprocedure);
    original := replace(original,E'\r\n',E'\n');
    anchor := '''VirusTotal: 1 engine flagged, rechecking daily'')';
    if length(original)-length(replace(original,anchor,'')) <> length(anchor) then
      raise exception 'QA coverage release reason anchor changed: %',signature;
    end if;
    definition := replace(original,anchor,'''VirusTotal: 1 engine flagged, rechecking daily'',''VirusTotal: awaiting engine coverage, rechecking daily'')');
    execute definition;
  end loop;
end;
$migration$;
