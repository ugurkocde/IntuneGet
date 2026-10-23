-- Persist only a fresh, exact active-candidate lookup through the existing authenticated completion.
-- Signature, owner, ACL, terminal fallback, metadata lane and shared v2 writer remain unchanged.
create or replace function public.complete_qa_vt_metadata_recheck(p_secret text,p_lease uuid,p_http_status integer,
  p_retry_at timestamptz default null,p_malicious integer default null,p_suspicious integer default null,
  p_total_engines integer default null,p_analyzed_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare item public.qa_vt_metadata_rechecks%rowtype; cached public.catalog_file_reputation%rowtype;
  stamp timestamptz; fallback boolean:=false; request public.qa_vt_requests%rowtype;
  intent public.qa_vt_submission_intents%rowtype; candidate public.qa_candidates%rowtype; active_candidate_id uuid;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  stamp := clock_timestamp();
  select * into item from public.qa_vt_metadata_rechecks where lease=p_lease
    and state='leased' for update;
  if not found then
    -- Probe without a request row lock, then keep candidate/request lock order
    -- identical to reservation. The global dispatch advisory lock is held.
    select candidate_id into active_candidate_id from public.qa_vt_requests where id=p_lease;
    select * into candidate from public.qa_candidates
      where id=active_candidate_id and finished_at is null for update;
    if found then
      select * into request from public.qa_vt_requests where id=p_lease for update;
      if not found or request.candidate_id is distinct from candidate.id
        or request.recheck_lease is not null or request.metadata_candidate_id is not null
        or request.operation is distinct from 'hash_lookup' or request.response_recorded_at is not null
        or request.reserved_at<=stamp-interval '2 minutes' or request.reserved_at>stamp
        or candidate.status not in ('dispatched','running') or candidate.test_level is distinct from 'psadt-package'
        or candidate.dispatched_at is null or request.reserved_at<candidate.dispatched_at
        or lower(candidate.installer_sha256) is distinct from request.sha256
        or p_http_status is distinct from 200 or p_retry_at is not null then
        raise exception 'QA active response binding rejected';
      end if;
      item.sha256:=request.sha256;fallback:=true;
    else
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
