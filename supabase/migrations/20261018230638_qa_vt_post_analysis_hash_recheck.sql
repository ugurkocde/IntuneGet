-- A submitted installer can finish through the existing exact file-hash reader
-- after its finite analysis polling lane is exhausted. No upload or counter reset.
create or replace function public.qa_vt_post_analysis_hash_recheck_ready(
  p_candidate_id uuid,p_sha256 text,p_run_id text,p_profile_sha256 text,p_stamp timestamptz)
returns boolean language sql stable set search_path='' as $function$
  select exists(select 1 from public.qa_vt_submission_intents i
    join public.qa_candidates c on c.id=i.candidate_id
    where i.candidate_id=p_candidate_id and i.sha256=p_sha256
      and i.github_run_id=p_run_id and i.profile_sha256=p_profile_sha256
      and public.qa_vt_submission_identity(i.candidate_id,i.sha256)
      and i.outcome='submitted' and i.upload_reserved_at is not null
      and i.analysis_id ~ '^[A-Za-z0-9=_-]{1,200}$' and i.analysis_recorded_at is not null
      and (select count(*) from public.qa_vt_requests r where r.candidate_id=i.candidate_id
        and r.sha256=i.sha256 and r.operation='analysis_lookup'
        and r.reserved_at>i.analysis_recorded_at)>=3
      and (select max(r.reserved_at) from public.qa_vt_requests r where r.candidate_id=i.candidate_id
        and r.sha256=i.sha256 and r.operation='analysis_lookup')<=p_stamp-interval '10 minutes'
      and not exists(select 1 from public.qa_vt_requests r where r.sha256=i.sha256
        and r.operation='hash_lookup' and r.reserved_at>i.analysis_recorded_at)
      and not exists(select 1 from public.qa_installer_security_holds h
        where h.sha256=i.sha256 and h.released_at is null and h.malicious_verdicts>0)
      and not exists(select 1 from public.qa_package_blocks b
        where lower(b.winget_id)=lower(i.winget_id) and b.version=i.version
          and b.architecture=i.architecture and lower(b.installer_sha256)=i.sha256))
$function$;
revoke all on function public.qa_vt_post_analysis_hash_recheck_ready(uuid,text,text,text,timestamptz)
  from public,anon,authenticated,service_role;

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
            and not exists(select 1 from public.qa_vt_request_budget where id=true and blocked_until>stamp))
          or (q.last_http_status=404 and q.state='pending' and q.attempts<6
            and public.qa_vt_terminal_public_source(c.id)
            and public.qa_vt_post_analysis_hash_recheck_ready(q.candidate_id,q.sha256,q.run_id,q.profile_sha256,stamp)))
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
  if item.last_http_status=404 and not public.qa_vt_post_analysis_hash_recheck_ready(
      item.candidate_id,item.sha256,item.run_id,item.profile_sha256,stamp) then continue;end if;
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
$function$