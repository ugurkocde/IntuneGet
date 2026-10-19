-- An audited pre-upload URL recovery never authorizes a second file upload.
-- Grants are inserted only by a separately reviewed operator migration, not an API.
create table public.qa_vt_upload_url_recovery_grants (
  sha256 text primary key check (sha256 ~ '^[a-f0-9]{64}$'),
  candidate_id uuid not null references public.qa_candidates(id),
  run_id text not null check (run_id ~ '^[1-9][0-9]*$'),
  profile_sha256 text not null check (profile_sha256 ~ '^[A-F0-9]{64}$'),
  original_upload_url_request_id uuid not null unique references public.qa_vt_requests(id),
  original_upload_url_reserved_at timestamptz not null,
  granted_at timestamptz not null default clock_timestamp(),
  reason text not null check (reason='preupload_response_recovery'),
  consumed_at timestamptz,
  consumed_request_id uuid unique references public.qa_vt_requests(id),
  check ((consumed_at is null) = (consumed_request_id is null))
);
alter table public.qa_vt_upload_url_recovery_grants enable row level security;
revoke all on public.qa_vt_upload_url_recovery_grants from public,anon,authenticated,service_role;

create function public.qa_vt_upload_url_recovery_ready(p_candidate_id uuid,p_sha256 text)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.qa_vt_upload_url_recovery_grants g
   join public.qa_vt_submission_intents i on i.sha256=g.sha256 and i.candidate_id=g.candidate_id
   join public.qa_candidates c on c.id=g.candidate_id
   join public.qa_vt_requests r on r.id=g.original_upload_url_request_id
   where g.sha256=p_sha256 and g.candidate_id=p_candidate_id and g.consumed_at is null
     and g.granted_at<=statement_timestamp()
     and g.run_id=c.github_run_id and g.profile_sha256=c.package_profile_sha256
     and g.run_id=i.github_run_id and g.profile_sha256=i.profile_sha256
     and i.upload_url_reserved_at=g.original_upload_url_reserved_at
     and i.upload_reserved_at is null and i.analysis_id is null and i.outcome='pending'
     and r.sha256=g.sha256 and r.candidate_id=g.candidate_id and r.operation='upload_url'
     and r.response_recorded_at is null
     and r.reserved_at<=g.original_upload_url_reserved_at
     and r.reserved_at>g.original_upload_url_reserved_at-interval '1 minute'
     and public.qa_vt_submission_identity(c.id,i.sha256)
     and public.qa_vt_submission_admissible(i.sha256)
     and not exists(select 1 from public.qa_vt_requests u where u.sha256=i.sha256 and u.operation='upload')
     -- A failed canary must not burn the remaining grants.
     and not exists(select 1 from public.qa_vt_upload_url_recovery_grants used
       join public.qa_vt_submission_intents stalled on stalled.sha256=used.sha256
       where used.consumed_at is not null and stalled.upload_reserved_at is null));
$$;
revoke all on function public.qa_vt_upload_url_recovery_ready(uuid,text) from public,anon,authenticated,service_role;

-- Advance eligible missing-report preflights before unseen metadata within customer priority.
-- Preserve exact identity, quota, cache validation, public submission and security holds.
CREATE OR REPLACE FUNCTION public.claim_qa_vt_metadata_recheck(p_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item public.qa_vt_metadata_rechecks%rowtype; cached public.catalog_file_reputation%rowtype;
  reservation jsonb; refusal jsonb; stamp timestamptz; last_lane text; lane text; submission public.qa_vt_submission_intents%rowtype; candidate public.qa_candidates%rowtype;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  stamp := clock_timestamp();
  update public.qa_vt_metadata_rechecks set state='escalated',lease=null,lease_expires_at=null
    where state in ('pending','leased') and (attempts>=6 or first_queued_at < stamp-interval '14 days')
      and (lease_expires_at is null or lease_expires_at<=stamp);
  select q.last_lane into last_lane from public.qa_vt_claim_lane q where q.id=true for update;
  if not found then raise exception 'QA VT offer cursor unavailable';end if;
  -- Try the opposite lane, falling back when it has no eligible offer.
  -- Flips record offers, including those that never make a provider reservation.
  foreach lane in array case when last_lane='metadata' then array['public','metadata'] else array['metadata','public'] end loop
  if lane='public' then
    if not exists(select 1 from public.qa_vt_request_budget where id=true and blocked_until>stamp) then
    select i.* into submission from public.qa_vt_submission_intents i
      where i.outcome='submitted' and i.analysis_id ~ '^[A-Za-z0-9=_-]{1,200}$'
        and public.qa_vt_submission_identity(i.candidate_id,i.sha256)
        and not exists(select 1 from public.catalog_file_reputation r where r.sha256=i.sha256 and r.status='found')
        and (select count(*) from public.qa_vt_requests r where r.candidate_id=i.candidate_id and r.operation='analysis_lookup')<3
        and coalesce((select max(r.reserved_at) from public.qa_vt_requests r
          where r.candidate_id=i.candidate_id and r.operation='analysis_lookup'),i.analysis_recorded_at)<=stamp-interval '10 minutes'
      order by i.analysis_recorded_at,i.candidate_id limit 1;
    if found then
      update public.qa_vt_claim_lane set last_lane='public',updated_at=stamp where id=true;
      return jsonb_build_object('stop','no_eligible_work','nextAnalysis',jsonb_build_object(
        'candidateId',submission.candidate_id,'sha256',submission.sha256));
    end if;
    select i.* into submission from public.qa_vt_submission_intents i
      join public.qa_candidates terminal on terminal.id=i.candidate_id
      where (i.upload_url_reserved_at is null or public.qa_vt_upload_url_recovery_ready(i.candidate_id,i.sha256)) and i.upload_reserved_at is null
        and public.qa_vt_submission_admissible(i.sha256)
        and (select count(*) from public.qa_vt_requests r where r.candidate_id=i.candidate_id
          and r.operation='hash_lookup' and r.recheck_lease is null
          and (terminal.status in ('dispatched','running') or r.reserved_at>=terminal.finished_at))<2
      order by i.verified_at,i.candidate_id limit 1;
    if found then
      update public.qa_vt_claim_lane set last_lane='public',updated_at=stamp where id=true;
      return jsonb_build_object('stop','no_eligible_work','nextSubmission',jsonb_build_object(
        'candidateId',submission.candidate_id,'sha256',submission.sha256,
        'installerUrl',submission.execution_installer_url));
    end if;
    end if;
  else
  select q.* into item from public.qa_vt_metadata_rechecks q
    join public.qa_candidates c on c.id=q.candidate_id and c.github_run_id=q.run_id
      and c.package_profile_sha256=q.profile_sha256 and lower(c.installer_sha256)=q.sha256
    where q.state in ('pending','leased') and q.retry_at<=stamp
      and (q.lease_expires_at is null or q.lease_expires_at<=stamp)
      and (q.preflight_lease_expires_at is null or q.preflight_lease_expires_at<=stamp)
      and c.finished_at is not null and c.phase='publishing'
      and c.status in ('error','passed','failed') and c.test_level='psadt-package'
      and public.qa_vt_terminal_identity(c.id)
      -- Cache reuse is quota-free. Only unresolved, non-passed tuples may
      -- enter the provider/preflight path; a found verdict is never re-looked up.
      and (exists(select 1 from public.catalog_file_reputation r where r.sha256=q.sha256
        and r.status='found' and r.engine_count_version=2
        and r.malicious between 0 and 9999 and r.suspicious between 0 and 9999
        and r.total_engines between 1 and 9999
        and r.malicious::bigint+r.suspicious::bigint<=r.total_engines
        and r.analyzed_at is not null and r.analyzed_at<=stamp
        and r.checked_at>stamp-interval '7 days' and r.checked_at<=stamp and r.retry_after>stamp)
      or (c.status<>'passed'
        and not exists(select 1 from public.catalog_file_reputation r where r.sha256=q.sha256 and r.status='found')
        and (q.last_http_status is distinct from 404
          or (q.state='pending' and q.preflight_completed_at is null
            and q.preflight_attempts<2 and q.attempts<6
            and public.qa_vt_terminal_public_source(c.id)
            and not exists(select 1 from public.qa_vt_request_budget where id=true and blocked_until>stamp)))
        and (q.last_http_status=404 or not exists(select 1 from public.qa_vt_requests r
          where r.sha256=q.sha256 and r.metadata_candidate_id is not null
            and r.reserved_at>stamp-interval '1 hour'))))
      and not exists(select 1 from public.qa_vt_metadata_rechecks other
        where other.sha256=q.sha256 and other.state='leased' and other.lease_expires_at>stamp)
      and not exists(select 1 from public.qa_vt_metadata_rechecks other
        where other.sha256=q.sha256 and other.preflight_lease_expires_at>stamp)
    order by exists(select 1 from public.packaging_jobs j where j.qa_candidate_id=q.candidate_id and j.status='awaiting_qa') desc,
      coalesce(q.last_http_status=404 and q.state='pending' and q.preflight_completed_at is null
        and q.preflight_attempts<2,false) desc,
      (c.status='error') desc,q.attempts,q.retry_at,q.candidate_id limit 1 for update of q skip locked;
  if not found then continue;end if;
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
    update public.qa_vt_claim_lane set last_lane='metadata',updated_at=stamp where id=true;
    return jsonb_build_object('cached',true,'candidateId',item.candidate_id);
  end if;
  if item.last_http_status=404 and item.state='pending' and item.preflight_completed_at is null
    and item.preflight_attempts<2 and item.attempts<6
    and public.qa_vt_terminal_public_source(item.candidate_id)
    and not exists(select 1 from public.qa_vt_request_budget where id=true and blocked_until>stamp)
    and not exists(select 1 from public.qa_vt_metadata_rechecks other where other.sha256=item.sha256
      and other.preflight_lease_expires_at>stamp) then
    select * into candidate from public.qa_candidates where id=item.candidate_id;
    update public.qa_vt_metadata_rechecks set preflight_lease=gen_random_uuid(),
      preflight_lease_expires_at=stamp+interval '2 minutes',preflight_attempts=preflight_attempts+1
      where candidate_id=item.candidate_id and run_id=item.run_id returning * into item;
    update public.qa_vt_claim_lane set last_lane='metadata',updated_at=stamp where id=true;
    return jsonb_build_object('stop','no_eligible_work','nextPreflight',jsonb_build_object(
      'candidateId',item.candidate_id,'runId',item.run_id,'profileSha256',item.profile_sha256,
      'sha256',item.sha256,'installerUrl',candidate.installer_url,'preflightLease',item.preflight_lease));
  end if;
  if item.last_http_status=404 then continue;end if;
  reservation := public.reserve_qa_vt_request(item.sha256,'hash_lookup');
  if reservation->>'reservationId' is null then
    update public.qa_vt_metadata_rechecks set state='pending',lease=null,lease_expires_at=null,
      retry_at=greatest(retry_at,(reservation->>'retryAt')::timestamptz) where candidate_id=item.candidate_id and run_id=item.run_id;
    refusal := reservation;
    continue;
  end if;
  update public.qa_vt_requests set metadata_candidate_id=item.candidate_id where id=(reservation->>'reservationId')::uuid;
  update public.qa_vt_metadata_rechecks set state='leased',lease=gen_random_uuid(),
    lease_expires_at=stamp+interval '2 minutes',attempts=attempts+1,
    reservation_id=(reservation->>'reservationId')::uuid where candidate_id=item.candidate_id and run_id=item.run_id returning * into item;
  update public.qa_vt_claim_lane set last_lane='metadata',updated_at=stamp where id=true;
  return jsonb_build_object('candidateId',item.candidate_id,'sha256',item.sha256,
    'lease',item.lease,'reservationId',item.reservation_id);
  end if;
  end loop;
  return coalesce(refusal,jsonb_build_object('stop','no_eligible_work'));
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_qa_vt_candidate_request(p_secret text, p_candidate_id uuid, p_sha256 text, p_operation text, p_lease uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.qa_candidates%rowtype; intent public.qa_vt_submission_intents%rowtype;
  cached public.catalog_file_reputation%rowtype; reservation jsonb; request_id uuid;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into c from public.qa_candidates where id=p_candidate_id for update;
  if not found or (c.status not in ('dispatched','running') and
      (p_lease is not null or p_operation not in ('hash_lookup','upload_url','upload','analysis_lookup')
        or not public.qa_vt_submission_identity(c.id,p_sha256))) or c.test_level is distinct from 'psadt-package'
    or p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_sha256=repeat('0',64)
    or p_operation is null or p_operation not in ('hash_lookup','upload_url','upload','analysis_lookup') then
    raise exception 'QA VirusTotal request binding rejected';
  end if;
  if p_lease is not null then
    if p_operation <> 'hash_lookup' or not exists(select 1 from public.qa_installer_security_holds
      where sha256=p_sha256 and released_at is null and recheck_lease=p_lease
        and recheck_lease_expires_at > clock_timestamp())
      or exists(select 1 from public.qa_vt_requests where recheck_lease=p_lease) then
      raise exception 'QA VirusTotal recheck lease rejected';
    end if;
  elsif lower(c.installer_sha256) is distinct from p_sha256 then
    raise exception 'QA VirusTotal installer hash rejected';
  elsif p_operation='hash_lookup' then
    if c.status not in ('dispatched','running') and
      (not public.qa_vt_submission_admissible(p_sha256) or exists(
        select 1 from public.qa_vt_submission_intents where sha256=p_sha256
          and upload_url_reserved_at is not null) and not public.qa_vt_upload_url_recovery_ready(c.id,p_sha256)) then
      raise exception 'Public installer terminal lookup unavailable';
    end if;
    select * into cached from public.catalog_file_reputation where sha256=p_sha256;
    if found and cached.status='found' and cached.engine_count_version=2
      and cached.malicious between 0 and 9999 and cached.suspicious between 0 and 9999
      and cached.total_engines between 1 and 9999
      and cached.malicious::bigint+cached.suspicious::bigint <= cached.total_engines
      and cached.analyzed_at is not null and cached.analyzed_at <= clock_timestamp()
      and cached.checked_at > clock_timestamp()-interval '7 days'
      and cached.checked_at <= clock_timestamp() and cached.retry_after > clock_timestamp() then
      return jsonb_build_object('cached',jsonb_build_object('malicious',cached.malicious,
        'suspicious',cached.suspicious,'totalEngines',cached.total_engines,'analyzedAt',cached.analyzed_at));
    end if;
    if (select count(*) from public.qa_vt_requests where candidate_id=c.id
      and operation='hash_lookup' and recheck_lease is null
      and (c.status in ('dispatched','running') or reserved_at>=c.finished_at))>=2 then
      raise exception 'QA VirusTotal candidate lookup budget exhausted';
    end if;
  else
    select * into intent from public.qa_vt_submission_intents where sha256=p_sha256 for update;
    if not found or intent.candidate_id is distinct from c.id
      or not public.qa_vt_submission_identity(c.id,p_sha256) then
      raise exception 'Public installer submission intent unavailable';
    end if;
    if p_operation='upload_url' and intent.upload_url_reserved_at is not null then
      perform 1 from public.qa_vt_upload_url_recovery_grants g where g.sha256=p_sha256
        and g.candidate_id=c.id and g.consumed_at is null for update;
      if not found or not public.qa_vt_upload_url_recovery_ready(c.id,p_sha256)
        or intent.hash_not_found_at <= (select granted_at from public.qa_vt_upload_url_recovery_grants where sha256=p_sha256) then
        raise exception 'Public installer URL recovery proof unavailable';
      end if;
    end if;
    if p_operation in ('upload_url','upload') then
      if not public.qa_vt_submission_admissible(p_sha256) then
        raise exception 'Public installer submission admission rejected';
      end if;
      -- The authenticated caller reports an actual provider404 against this
      -- exact reserved request. Cache absence is never proof of a missing file.
      if intent.hash_lookup_reservation_id is null or intent.hash_not_found_at is null
        or (p_operation='upload_url' and (intent.hash_not_found_at<=clock_timestamp()-interval '5 minutes'
          or intent.hash_not_found_at>clock_timestamp()))
        or (p_operation='upload' and (intent.upload_url_reserved_at is null
          or intent.upload_url_reserved_at<=clock_timestamp()-interval '10 minutes'
          or intent.upload_url_reserved_at>clock_timestamp())) then
        raise exception 'Public installer provider404 proof unavailable';
      end if;
      if intent.verified_at <= clock_timestamp()-interval '6 hours' or intent.outcome<>'pending'
        or intent.upload_reserved_at is not null
        or (p_operation='upload_url' and intent.upload_url_reserved_at is not null
          and not public.qa_vt_upload_url_recovery_ready(c.id,p_sha256)) then
        raise exception 'Public installer submission already reserved or stale';
      end if;
    elsif intent.upload_reserved_at is null or intent.analysis_id is null or intent.outcome<>'submitted'
      or (select count(*) from public.qa_vt_requests where candidate_id=c.id and operation='analysis_lookup')>=3 then
      raise exception 'Public installer analysis unavailable';
    end if;
  end if;
  -- Bind the server-established dispatch to the first observed GitHub run.
  if p_lease is null and p_operation in ('hash_lookup','upload_url','upload','analysis_lookup')
    and public.qa_vt_submission_identity(c.id,p_sha256) then
    update public.qa_vt_submission_intents set github_run_id=c.github_run_id
      where sha256=p_sha256 and github_run_id is null;
  end if;
  -- Reuse the unchanged global advisory lock, limits and Retry-After function.
  -- Its transaction lock remains held while this reservation is bound below.
  reservation := public.reserve_qa_vt_request(p_sha256,p_operation);
  request_id := (reservation->>'reservationId')::uuid;
  if request_id is null then return reservation; end if;
  update public.qa_vt_requests set candidate_id=c.id,recheck_lease=p_lease where id=request_id;
  if p_operation='upload_url' then
    if intent.upload_url_reserved_at is not null then
      update public.qa_vt_upload_url_recovery_grants set consumed_at=clock_timestamp(),consumed_request_id=request_id
        where sha256=p_sha256 and candidate_id=c.id and consumed_at is null;
      if not found then raise exception 'Public installer URL recovery already consumed';end if;
    end if;
    update public.qa_vt_submission_intents set upload_url_reserved_at=clock_timestamp() where sha256=p_sha256;
  elsif p_operation='upload' then
    update public.qa_vt_submission_intents set upload_reserved_at=clock_timestamp() where sha256=p_sha256;
  end if;
  if p_operation in ('upload_url','upload') then
    reservation := reservation || jsonb_build_object('installerUrl',intent.execution_installer_url);
  elsif p_operation='analysis_lookup' then
    reservation := reservation || jsonb_build_object('analysisId',intent.analysis_id);
  end if;
  return reservation;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_qa_vt_submission_analysis(p_secret text, p_candidate_id uuid, p_sha256 text, p_analysis_id text, p_outcome text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      or intent.outcome<>'pending' or (intent.upload_url_reserved_at is not null
        and not public.qa_vt_upload_url_recovery_ready(p_candidate_id,p_sha256))
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
      or request.reserved_at<=intent.hash_not_found_at
      or (intent.upload_url_reserved_at is not null and request.reserved_at <=
        (select granted_at from public.qa_vt_upload_url_recovery_grants where sha256=p_sha256)) then
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
$function$;
