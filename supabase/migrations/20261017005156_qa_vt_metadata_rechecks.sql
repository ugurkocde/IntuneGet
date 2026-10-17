-- Preparatory only. Apply with the reviewed global quota migrations and
-- qualified callers. This records metadata, never a VM pass or release.
alter table public.qa_vt_request_budget add column metering_started_at timestamptz
  not null default clock_timestamp();

alter table public.qa_vt_requests add column metadata_candidate_id uuid;

create table public.qa_vt_metadata_rechecks (
  candidate_id uuid not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$' and sha256 <> repeat('0',64)),
  profile_sha256 text not null check (profile_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  run_id text not null check (run_id ~ '^[1-9][0-9]*$'),
  state text not null default 'pending' check (state in ('pending','leased','resolved','escalated')),
  first_queued_at timestamptz not null default clock_timestamp(),
  retry_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 6),
  lease uuid, lease_expires_at timestamptz, reservation_id uuid,
  last_http_status integer not null default 429 check (last_http_status between 0 and 599),
  malicious integer, suspicious integer, total_engines integer,
  analyzed_at timestamptz, checked_at timestamptz,
  primary key(candidate_id,run_id)
);
create index qa_vt_metadata_rechecks_due_idx on public.qa_vt_metadata_rechecks(retry_at)
  where state in ('pending','leased');
alter table public.qa_vt_metadata_rechecks enable row level security;
revoke all on public.qa_vt_metadata_rechecks from public,anon,authenticated,service_role;
grant select on public.qa_vt_metadata_rechecks to service_role;

-- Retain the full absolute deadline, including beyond seven days. Reject
-- implausible dates beyond31days rather than silently truncating them.
-- A caller receiving this error must retain its hold and escalate invalid
-- provider metadata, never retry inline or turn the result clean.
create function public.defer_qa_vt_requests_until(p_reservation uuid,p_retry_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
declare stamp timestamptz := clock_timestamp();
begin
  if p_retry_at is null or not isfinite(p_retry_at) or p_retry_at <= stamp or p_retry_at>stamp+interval '31 days' then
    raise exception 'Invalid VirusTotal retry deadline';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('intuneget-vt-request-budget',0));
  if not exists(select 1 from public.qa_vt_requests where id=p_reservation
    and reserved_at between stamp-interval '10 minutes' and stamp) then
    raise exception 'VirusTotal request reservation unavailable';
  end if;
  update public.qa_vt_request_budget set blocked_until=greatest(blocked_until,p_retry_at) where id=true;
  if not found then raise exception 'VirusTotal request budget unavailable'; end if;
end;
$$;
revoke all on function public.defer_qa_vt_requests_until(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.defer_qa_vt_requests_until(uuid,timestamptz) to service_role;

-- Same authenticated reservation-owner boundary as the existing seconds API,
-- but daily rechecks and future reserved operations retain an absolute deadline.
create function public.defer_qa_vt_candidate_requests_until(p_secret text,p_candidate_id uuid,
  p_reservation uuid,p_retry_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  if not exists(select 1 from public.qa_vt_requests where id=p_reservation and candidate_id=p_candidate_id) then
    raise exception 'QA VirusTotal reservation owner rejected';
  end if;
  perform public.defer_qa_vt_requests_until(p_reservation,p_retry_at);
end;
$$;
revoke all on function public.defer_qa_vt_candidate_requests_until(text,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.defer_qa_vt_candidate_requests_until(text,uuid,uuid,timestamptz) to anon,service_role;

-- Called only after a reserved candidate lookup actually returned HTTP429.
-- Authentication and reservation ownership are the existing reporter boundary.
-- A generic publication error alone is never sufficient to enqueue work.
create function public.report_qa_vt_candidate_rate_limit(p_secret text,p_candidate_id uuid,
  p_reservation uuid,p_retry_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.qa_candidates%rowtype; stamp timestamptz := clock_timestamp();
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into c from public.qa_candidates where id=p_candidate_id for update;
  if not found or c.status not in ('dispatched','running') or c.test_level is distinct from 'psadt-package'
    or c.github_run_id is null or c.github_run_id !~ '^[1-9][0-9]*$'
    or c.package_profile_sha256 is null or c.package_profile_sha256 !~ '^[A-Fa-f0-9]{64}$'
    or not exists(select 1 from public.qa_vt_requests where id=p_reservation
      and candidate_id=c.id and sha256=lower(c.installer_sha256) and operation='hash_lookup'
      and recheck_lease is null) then
    raise exception 'QA VirusTotal rate limit binding rejected';
  end if;
  -- Lock order is dispatch, then budget, for every caller.
  perform public.defer_qa_vt_requests_until(p_reservation,p_retry_at);
  insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at)
  values(c.id,lower(c.installer_sha256),c.package_profile_sha256,c.github_run_id,
    greatest(p_retry_at,stamp+interval '60 seconds'))
  on conflict(candidate_id,run_id) do update set retry_at=greatest(qa_vt_metadata_rechecks.retry_at,excluded.retry_at),
    state=case when qa_vt_metadata_rechecks.state in ('resolved','escalated') then 'pending' else qa_vt_metadata_rechecks.state end,
    last_http_status=429
  where qa_vt_metadata_rechecks.sha256=excluded.sha256
    and qa_vt_metadata_rechecks.profile_sha256=excluded.profile_sha256
    and qa_vt_metadata_rechecks.run_id=excluded.run_id;
  if not found then raise exception 'QA VirusTotal metadata identity changed'; end if;
end;
$$;
revoke all on function public.report_qa_vt_candidate_rate_limit(text,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.report_qa_vt_candidate_rate_limit(text,uuid,uuid,timestamptz) to anon,service_role;

-- Independent of an active VM. A reservation is spent before the caller sees
-- it; transport failures and expired leases never refund quota.
create function public.claim_qa_vt_metadata_recheck(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.qa_vt_metadata_rechecks%rowtype; cached public.catalog_file_reputation%rowtype;
  reservation jsonb; stamp timestamptz;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  stamp := clock_timestamp();
  update public.qa_vt_metadata_rechecks set state='escalated',lease=null,lease_expires_at=null
    where state in ('pending','leased') and (attempts>=6 or first_queued_at < stamp-interval '14 days')
      and (lease_expires_at is null or lease_expires_at<=stamp);
  select q.* into item from public.qa_vt_metadata_rechecks q
    join public.qa_candidates c on c.id=q.candidate_id and c.github_run_id=q.run_id
      and c.package_profile_sha256=q.profile_sha256 and lower(c.installer_sha256)=q.sha256
    where q.state in ('pending','leased') and q.retry_at<=stamp
      and (q.lease_expires_at is null or q.lease_expires_at<=stamp)
      and c.finished_at is not null and c.phase='publishing'
      and c.status in ('error','passed','failed') and c.test_level='psadt-package'
      and not exists(select 1 from public.qa_vt_metadata_rechecks other
        where other.sha256=q.sha256 and other.state='leased' and other.lease_expires_at>stamp)
    order by q.retry_at,q.candidate_id limit 1 for update of q skip locked;
  if not found then return jsonb_build_object('stop','no_eligible_work'); end if;
  select * into cached from public.catalog_file_reputation where sha256=item.sha256;
  if found and cached.status='found' and cached.engine_count_version=2
    and cached.malicious between 0 and 9999 and cached.suspicious between 0 and 9999
    and cached.total_engines between 1 and 9999
    and cached.malicious::bigint+cached.suspicious::bigint<=cached.total_engines
    and cached.analyzed_at is not null and cached.analyzed_at<=stamp
    and cached.checked_at>stamp-interval '7 days' and cached.checked_at<=stamp and cached.retry_after>stamp then
    update public.qa_vt_metadata_rechecks set state='resolved',lease=null,lease_expires_at=null,
      last_http_status=200,malicious=cached.malicious,suspicious=cached.suspicious,
      total_engines=cached.total_engines,analyzed_at=cached.analyzed_at,checked_at=cached.checked_at
      where candidate_id=item.candidate_id and run_id=item.run_id;
    return jsonb_build_object('cached',true,'candidateId',item.candidate_id);
  end if;
  reservation := public.reserve_qa_vt_request(item.sha256,'hash_lookup');
  if reservation->>'reservationId' is null then
    update public.qa_vt_metadata_rechecks set state='pending',lease=null,lease_expires_at=null,
      retry_at=greatest(retry_at,(reservation->>'retryAt')::timestamptz) where candidate_id=item.candidate_id and run_id=item.run_id;
    return reservation;
  end if;
  update public.qa_vt_requests set metadata_candidate_id=item.candidate_id where id=(reservation->>'reservationId')::uuid;
  update public.qa_vt_metadata_rechecks set state='leased',lease=gen_random_uuid(),
    lease_expires_at=stamp+interval '2 minutes',attempts=attempts+1,
    reservation_id=(reservation->>'reservationId')::uuid where candidate_id=item.candidate_id and run_id=item.run_id returning * into item;
  return jsonb_build_object('candidateId',item.candidate_id,'sha256',item.sha256,
    'lease',item.lease,'reservationId',item.reservation_id);
end;
$$;
revoke all on function public.claim_qa_vt_metadata_recheck(text) from public,anon,authenticated;
grant execute on function public.claim_qa_vt_metadata_recheck(text) to anon,service_role;

-- Qualified newer cache evidence is also consumed by the existing reviewed
-- installer security-hold refresh path; it grants no VM or release credit.
create function public.complete_qa_vt_metadata_recheck(p_secret text,p_lease uuid,p_http_status integer,
  p_retry_at timestamptz default null,p_malicious integer default null,p_suspicious integer default null,
  p_total_engines integer default null,p_analyzed_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare item public.qa_vt_metadata_rechecks%rowtype; cached public.catalog_file_reputation%rowtype;
  stamp timestamptz;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  stamp := clock_timestamp();
  select * into item from public.qa_vt_metadata_rechecks where lease=p_lease
    and state='leased' for update;
  -- A late 429 can still defer globally while this exact lease has not been
  -- replaced. Success never accepts an expired lease. Future HTTP timeout <2min.
  if not found or p_http_status is null or p_http_status not between 0 and 599
    or (item.lease_expires_at<=stamp and p_http_status<>429) then
    raise exception 'QA VirusTotal metadata lease rejected';
  end if;
  if p_http_status=200 then
    if p_malicious is null or p_suspicious is null or p_total_engines is null
      or p_malicious not between 0 and 9999 or p_suspicious not between 0 and 9999
      or p_total_engines not between 1 and 9999 or p_malicious::bigint+p_suspicious::bigint>p_total_engines
      or p_analyzed_at is null or not isfinite(p_analyzed_at) or p_analyzed_at>stamp then
      raise exception 'Invalid VirusTotal metadata verdict';
    end if;
    insert into public.catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,
      engine_count_version,analyzed_at,checked_at,retry_after)
    values(item.sha256,'found',p_malicious,p_suspicious,p_total_engines,2,p_analyzed_at,stamp,stamp+interval '7 days')
    on conflict(sha256) do update set status=excluded.status,malicious=excluded.malicious,
      suspicious=excluded.suspicious,total_engines=excluded.total_engines,engine_count_version=2,
      analyzed_at=excluded.analyzed_at,checked_at=excluded.checked_at,retry_after=excluded.retry_after
    where excluded.analyzed_at>=coalesce(catalog_file_reputation.analyzed_at,'-infinity'::timestamptz)
      and excluded.checked_at>=coalesce(catalog_file_reputation.checked_at,'-infinity'::timestamptz);
    select * into cached from public.catalog_file_reputation where sha256=item.sha256;
    if cached.status is distinct from 'found' or cached.engine_count_version is distinct from 2
      or cached.malicious is null or cached.suspicious is null or cached.total_engines is null
      or cached.malicious not between 0 and 9999 or cached.suspicious not between 0 and 9999
      or cached.total_engines not between 1 and 9999
      or cached.malicious::bigint+cached.suspicious::bigint>cached.total_engines
      or cached.analyzed_at is null or cached.analyzed_at>stamp
      or cached.checked_at is null or cached.checked_at>stamp
      or cached.checked_at<=stamp-interval '7 days' or cached.retry_after is null or cached.retry_after<=stamp then
      raise exception 'Newer VirusTotal cache evidence is not qualified';
    end if;
    update public.qa_vt_metadata_rechecks set state='resolved',last_http_status=200,
      malicious=cached.malicious,suspicious=cached.suspicious,total_engines=cached.total_engines,
      analyzed_at=cached.analyzed_at,checked_at=cached.checked_at,lease=null,lease_expires_at=null where candidate_id=item.candidate_id and run_id=item.run_id;
  else
    if p_retry_at is not null and (not isfinite(p_retry_at) or p_retry_at<=stamp or p_retry_at>stamp+interval '31 days') then
      raise exception 'Invalid VirusTotal metadata retry deadline';
    end if;
    p_retry_at := greatest(p_retry_at,stamp+interval '15 minutes');
    if p_http_status=429 then perform public.defer_qa_vt_requests_until(item.reservation_id,p_retry_at); end if;
    update public.qa_vt_metadata_rechecks set state='pending',last_http_status=p_http_status,
      retry_at=greatest(retry_at,p_retry_at),lease=null,lease_expires_at=null where candidate_id=item.candidate_id and run_id=item.run_id;
  end if;
end;
$$;
revoke all on function public.complete_qa_vt_metadata_recheck(text,uuid,integer,timestamptz,integer,integer,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.complete_qa_vt_metadata_recheck(text,uuid,integer,timestamptz,integer,integer,integer,timestamptz) to anon,service_role;

create function public.qa_vt_request_stats(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare stamp timestamptz; result jsonb;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  stamp := clock_timestamp();
  select jsonb_build_object('observedAt',stamp,'usedToday',count(*) filter(where reserved_at>=date_trunc('day',stamp at time zone 'UTC') at time zone 'UTC'),
    'used24h',count(*) filter(where reserved_at>stamp-interval '24 hours'),
    'minuteUsed',count(*) filter(where reserved_at>stamp-interval '60 seconds'),
    'providerDailyLimit',500,'internalRollingCap',450,'meteredReservationsOnly',true,
    'untrackedBefore',(select metering_started_at from public.qa_vt_request_budget where id=true),
    'blockedUntil',(select blocked_until from public.qa_vt_request_budget where id=true),
    'heldOnly429',(select count(*) from public.qa_vt_metadata_rechecks q join public.qa_candidates c on c.id=q.candidate_id
      and c.github_run_id=q.run_id and c.package_profile_sha256=q.profile_sha256 and lower(c.installer_sha256)=q.sha256
      where q.state<>'resolved' and q.last_http_status=429 and c.finished_at is not null and c.phase='publishing'),
    'pending',(select count(*) from public.qa_vt_metadata_rechecks where state in ('pending','leased')),
    'escalated',(select count(*) from public.qa_vt_metadata_rechecks where state='escalated'))
    into result from public.qa_vt_requests where reserved_at<=stamp;
  return result;
end;
$$;
revoke all on function public.qa_vt_request_stats(text) from public,anon,authenticated;
grant execute on function public.qa_vt_request_stats(text) to anon,service_role;
