-- Preparatory completion contract. The public installer consumer is not activated.
-- No API signature, credential, grant, security hold or quota window changes.
alter table public.qa_vt_requests add column response_recorded_at timestamptz
  check (response_recorded_at is null or response_recorded_at>=reserved_at);

create or replace function public.complete_qa_vt_metadata_recheck(p_secret text,p_lease uuid,p_http_status integer,
  p_retry_at timestamptz default null,p_malicious integer default null,p_suspicious integer default null,
  p_total_engines integer default null,p_analyzed_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare item public.qa_vt_metadata_rechecks%rowtype; cached public.catalog_file_reputation%rowtype;
  stamp timestamptz; fallback boolean:=false; request public.qa_vt_requests%rowtype;
  intent public.qa_vt_submission_intents%rowtype; candidate public.qa_candidates%rowtype;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  stamp := clock_timestamp();
  select * into item from public.qa_vt_metadata_rechecks where lease=p_lease
    and state='leased' for update;
  if not found then
    -- No new endpoint or credential. Only a terminal candidate request can use
    -- this alternate id; real metadata leases retain the unchanged path below.
    select * into request from public.qa_vt_requests where id=p_lease for update;
    if not found or request.candidate_id is null or request.recheck_lease is not null
      or request.metadata_candidate_id is not null or request.operation not in ('hash_lookup','analysis_lookup')
      or request.response_recorded_at is not null or request.reserved_at<=stamp-interval '2 minutes'
      or request.reserved_at>stamp then raise exception 'QA terminal response reservation rejected'; end if;
    select * into candidate from public.qa_candidates where id=request.candidate_id;
    select * into intent from public.qa_vt_submission_intents where sha256=request.sha256;
    if candidate.finished_at is null or request.reserved_at<candidate.finished_at
      or intent.candidate_id is distinct from request.candidate_id
      or not public.qa_vt_submission_identity(request.candidate_id,request.sha256)
      or (request.operation='hash_lookup' and intent.outcome<>'pending')
      or (request.operation='analysis_lookup' and (intent.outcome<>'submitted'
        or intent.analysis_id is null or intent.analysis_recorded_at is null
        or request.reserved_at<=intent.analysis_recorded_at)) then
      raise exception 'QA terminal response identity rejected';
    end if;
    if p_http_status is null or not (p_http_status=200 or p_http_status=0
      or (request.operation='analysis_lookup' and p_http_status in (202,404))) then
      raise exception 'QA terminal response status rejected';
    end if;
    -- 0 means transport failure; 202 is a still-pending analysis and analysis404
    -- has no verdict. Hash404 and429 have their own authenticated writers.
    if p_http_status<>200 then
      if p_retry_at is not null or p_malicious is not null or p_suspicious is not null
        or p_total_engines is not null or p_analyzed_at is not null then
        raise exception 'QA terminal no-verdict payload rejected';
      end if;
      update public.qa_vt_requests set response_recorded_at=stamp
        where id=request.id and response_recorded_at is null;
      if not found then raise exception 'QA terminal response already recorded'; end if;
      return;
    end if;
    if p_retry_at is not null or (request.operation='analysis_lookup' and
      (intent.upload_reserved_at is null or p_analyzed_at is null
        or p_analyzed_at<intent.upload_reserved_at-interval '5 minutes')) then
      raise exception 'QA terminal analysis date rejected';
    end if;
    item.sha256:=request.sha256;fallback:=true;
  end if;
  -- A late 429 can still defer globally while this exact lease has not been
  -- replaced. Success never accepts an expired lease. Future HTTP timeout <2min.
  if (not fallback and item.lease is null) or p_http_status is null or p_http_status not between 0 and 599
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
  if fallback then
    update public.qa_vt_requests set response_recorded_at=stamp
      where id=request.id and response_recorded_at is null;
    if not found then raise exception 'QA terminal response already recorded'; end if;
  end if;
end;
$$;

create or replace function public.record_qa_vt_submission_analysis(p_secret text,p_candidate_id uuid,
  p_sha256 text,p_analysis_id text,p_outcome text) returns void
language plpgsql security definer set search_path = '' as $$
declare intent public.qa_vt_submission_intents%rowtype; request public.qa_vt_requests%rowtype;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  if not public.qa_vt_submission_identity(p_candidate_id,p_sha256) then raise exception 'QA submission candidate rejected'; end if;
  select * into intent from public.qa_vt_submission_intents where sha256=p_sha256
    and candidate_id=p_candidate_id for update;
  if not found then raise exception 'QA submission intent unavailable'; end if;
  if p_outcome='not_found' then
    if p_analysis_id is null or p_analysis_id !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'
      or intent.outcome<>'pending' or intent.upload_url_reserved_at is not null
      or intent.upload_reserved_at is not null
      or not public.qa_vt_submission_admissible(p_sha256) then
      raise exception 'QA submission provider404 proof rejected';
    end if;
    select * into request from public.qa_vt_requests where id=p_analysis_id::uuid;
    if not found or request.candidate_id is distinct from p_candidate_id
      or request.sha256 is distinct from p_sha256 or request.operation<>'hash_lookup'
      or request.recheck_lease is not null or request.metadata_candidate_id is not null
      or request.response_recorded_at is not null
      or request.reserved_at<=clock_timestamp()-interval '5 minutes'
      or request.reserved_at>clock_timestamp() or request.reserved_at<intent.dispatch_started_at
      or request.reserved_at<intent.verified_at
      or intent.hash_lookup_reservation_id=request.id
      or request.reserved_at<=intent.hash_not_found_at then
      raise exception 'QA submission provider404 reservation rejected';
    end if;
    update public.qa_vt_submission_intents set hash_lookup_reservation_id=request.id,
      hash_not_found_at=request.reserved_at where sha256=p_sha256;
    update public.qa_vt_requests set response_recorded_at=clock_timestamp()
      where id=request.id and response_recorded_at is null;
    if not found then raise exception 'QA terminal response already recorded'; end if;
    return;
  end if;
  if intent.outcome<>'pending'
    or p_outcome is null or p_outcome not in ('submitted','ambiguous','too_large','integrity_failed')
    or (p_outcome in ('submitted','ambiguous') and intent.upload_reserved_at is null)
    or (p_outcome='submitted' and (p_analysis_id is null or p_analysis_id !~ '^[A-Za-z0-9=_-]{1,200}$'))
    or (p_outcome<>'submitted' and p_analysis_id is not null) then
    raise exception 'QA submission analysis write rejected';
  end if;
  update public.qa_vt_submission_intents set analysis_id=p_analysis_id,
    outcome=p_outcome,analysis_recorded_at=clock_timestamp() where sha256=p_sha256;
end;
$$;

create or replace function public.claim_qa_vt_metadata_recheck(p_secret text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.qa_vt_metadata_rechecks%rowtype; cached public.catalog_file_reputation%rowtype;
  reservation jsonb; stamp timestamptz; submission public.qa_vt_submission_intents%rowtype;
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
  if not found then
    -- Existing callers stop on this field. Only the qualified consumer reads nextSubmission.
    -- This selection spends no quota, changes no hold and grants no upload reservation.
    if exists(select 1 from public.qa_vt_request_budget where id=true and blocked_until>stamp) then
      return jsonb_build_object('stop','no_eligible_work');
    end if;
    select i.* into submission from public.qa_vt_submission_intents i
      where i.outcome='submitted' and i.analysis_id ~ '^[A-Za-z0-9=_-]{1,200}$'
        and public.qa_vt_submission_identity(i.candidate_id,i.sha256)
        and not exists(select 1 from public.catalog_file_reputation r where r.sha256=i.sha256 and r.status='found')
        and (select count(*) from public.qa_vt_requests r where r.candidate_id=i.candidate_id and r.operation='analysis_lookup')<3
        and coalesce((select max(r.reserved_at) from public.qa_vt_requests r
          where r.candidate_id=i.candidate_id and r.operation='analysis_lookup'),i.analysis_recorded_at)<=stamp-interval '10 minutes'
      order by i.analysis_recorded_at,i.candidate_id limit 1;
    if found then
      return jsonb_build_object('stop','no_eligible_work','nextAnalysis',jsonb_build_object(
        'candidateId',submission.candidate_id,'sha256',submission.sha256));
    end if;
    select i.* into submission from public.qa_vt_submission_intents i
      join public.qa_candidates terminal on terminal.id=i.candidate_id
      where i.upload_url_reserved_at is null and i.upload_reserved_at is null
        and public.qa_vt_submission_admissible(i.sha256)
        and (select count(*) from public.qa_vt_requests r where r.candidate_id=i.candidate_id
          and r.operation='hash_lookup' and r.recheck_lease is null
          and (terminal.status in ('dispatched','running') or r.reserved_at>=terminal.finished_at))<2
      order by i.verified_at,i.candidate_id limit 1;
    if found then
      return jsonb_build_object('stop','no_eligible_work','nextSubmission',jsonb_build_object(
        'candidateId',submission.candidate_id,'sha256',submission.sha256,
        'installerUrl',submission.execution_installer_url));
    end if;
    return jsonb_build_object('stop','no_eligible_work');
  end if;
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

create or replace function public.qa_vt_request_stats(p_secret text) returns jsonb
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
    'submittedAwaitingAnalysis',(select count(*) from public.qa_vt_submission_intents where outcome='submitted'),
    'analysisBudgetExhausted',(select count(*) from public.qa_vt_submission_intents i where i.outcome='submitted'
      and (select count(*) from public.qa_vt_requests r where r.candidate_id=i.candidate_id and r.operation='analysis_lookup')>=3),
    'pending',(select count(*) from public.qa_vt_metadata_rechecks where state in ('pending','leased')),
    'escalated',(select count(*) from public.qa_vt_metadata_rechecks where state='escalated'))
    into result from public.qa_vt_requests where reserved_at<=stamp;
  return result;
end;
$$;
