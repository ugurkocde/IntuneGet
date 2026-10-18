-- Shared historical publication recovery. Admission is not an HTTP response,
-- installer approval, lifecycle pass, hold release or customer completion.
alter table public.qa_vt_metadata_rechecks alter column last_http_status drop not null;
alter table public.qa_vt_metadata_rechecks
  add column preflight_lease uuid,
  add column preflight_lease_expires_at timestamptz,
  add column preflight_attempts smallint not null default 0 check (preflight_attempts between 0 and 2),
  add column preflight_completed_at timestamptz;

create function public.qa_vt_terminal_identity(p_candidate_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.qa_candidates c where c.id=p_candidate_id
    and c.test_level='psadt-package' and c.status in ('error','failed','passed')
    and c.phase='publishing' and c.finished_at is not null
    and c.finished_at<=statement_timestamp() and c.dispatched_at is not null and c.attempts is not null
    and c.github_run_id ~ '^[1-9][0-9]*$' and c.package_profile_sha256 ~ '^[A-Fa-f0-9]{64}$'
    and lower(c.installer_sha256) ~ '^[a-f0-9]{64}$' and lower(c.installer_sha256)<>repeat('0',64)
    and not exists(select 1 from public.qa_candidates newer
      where lower(newer.winget_id)=lower(c.winget_id) and newer.architecture=c.architecture
        and newer.status<>'superseded' and newer.enqueued_at>c.enqueued_at
        and (lower(newer.installer_sha256) is distinct from lower(c.installer_sha256)
          or newer.package_profile_sha256 is distinct from c.package_profile_sha256
          or newer.version is distinct from c.version)))
$$;
revoke all on function public.qa_vt_terminal_identity(uuid) from public,anon,authenticated,service_role;
grant execute on function public.qa_vt_terminal_identity(uuid) to service_role;

create function public.qa_vt_terminal_public_source(p_candidate_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.qa_candidates c where c.id=p_candidate_id
    and public.qa_vt_terminal_identity(c.id)
    and c.winget_id is not null and lower(c.winget_id) not like 'custom.%'
    and lower(c.winget_id) not like 'intuneget.curated.%'
    and c.installer_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9](:443)?(/|$)'
    and split_part(substring(c.installer_url from 9),'/',1) !~ '^[0-9.]+(:443)?$'
    and lower(split_part(split_part(substring(c.installer_url from 9),'/',1),':',1)) !~ '(^localhost$|\.localhost$|\.local$|\.internal$|\.$)'
    and c.installer_url !~ '[[:space:]#]'
    and not exists(select 1 from public.catalog_file_reputation r
      where r.sha256=lower(c.installer_sha256) and r.status='found')
    and not exists(select 1 from public.qa_installer_security_holds h
      where h.sha256=lower(c.installer_sha256) and h.released_at is null and h.malicious_verdicts>0)
    and not exists(select 1 from public.qa_package_blocks b
      where lower(b.winget_id)=lower(c.winget_id) and b.version=c.version
        and b.architecture=c.architecture and lower(b.installer_sha256)=lower(c.installer_sha256))
    and not exists(select 1 from public.installer_health h
      where lower(h.expected_sha256)=lower(c.installer_sha256) and h.status='quarantined')
    and not exists(select 1 from public.qa_vt_submission_intents i
      where i.sha256=lower(c.installer_sha256) and
        (i.outcome<>'pending' or i.upload_url_reserved_at is not null or i.upload_reserved_at is not null
          or i.analysis_id is not null or i.analysis_recorded_at is not null)))
$$;
revoke all on function public.qa_vt_terminal_public_source(uuid) from public,anon,authenticated,service_role;
grant execute on function public.qa_vt_terminal_public_source(uuid) to service_role;

create function public.admit_qa_vt_terminal_metadata_rechecks(p_secret text) returns integer
language plpgsql security definer set search_path = '' as $$
declare inserted integer; stamp timestamptz;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  stamp:=clock_timestamp();
  insert into public.qa_vt_metadata_rechecks(candidate_id,sha256,profile_sha256,run_id,retry_at,last_http_status)
  select c.id,lower(c.installer_sha256),c.package_profile_sha256,c.github_run_id,stamp,null
  from public.qa_candidates c
  where public.qa_vt_terminal_identity(c.id)
    and c.finished_at>=stamp-interval '14 days'
    and not exists(select 1 from public.qa_vt_metadata_rechecks q
      where q.candidate_id=c.id and q.run_id=c.github_run_id)
  order by exists(select 1 from public.packaging_jobs j where j.qa_candidate_id=c.id and j.status='awaiting_qa') desc,
    c.finished_at,c.id limit 100
  on conflict(candidate_id,run_id) do nothing;
  get diagnostics inserted=row_count;
  return inserted;
end;
$$;
revoke all on function public.admit_qa_vt_terminal_metadata_rechecks(text) from public,anon,authenticated,service_role;
grant execute on function public.admit_qa_vt_terminal_metadata_rechecks(text) to anon,service_role;

create function public.record_qa_vt_terminal_preflight(p_secret text,p_preflight_lease uuid,
  p_candidate_id uuid,p_sha256 text,p_outcome text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare item public.qa_vt_metadata_rechecks%rowtype; c public.qa_candidates%rowtype; stamp timestamptz; written integer;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  stamp:=clock_timestamp();
  select * into item from public.qa_vt_metadata_rechecks where preflight_lease=p_preflight_lease
    and preflight_lease_expires_at>stamp and state='pending' and last_http_status=404 for update;
  if not found or item.candidate_id is distinct from p_candidate_id or item.sha256 is distinct from p_sha256
    or p_outcome is null or p_outcome not in ('verified','integrity_failed','too_large') then
    raise exception 'QA terminal preflight lease rejected';
  end if;
  select * into c from public.qa_candidates where id=item.candidate_id for update;
  if not public.qa_vt_terminal_public_source(c.id) or c.github_run_id is distinct from item.run_id
    or c.package_profile_sha256 is distinct from item.profile_sha256
    or lower(c.installer_sha256) is distinct from item.sha256 then
    raise exception 'QA terminal preflight identity rejected';
  end if;
  update public.qa_vt_metadata_rechecks set preflight_lease=null,preflight_lease_expires_at=null,
    preflight_completed_at=stamp where candidate_id=item.candidate_id and run_id=item.run_id;
  if p_outcome<>'verified' then return jsonb_build_object('admitted',false);end if;
  -- The authenticated hosted consumer has just downloaded and hashed this exact
  -- server-selected public URL. This evidence is private to VT submission, not
  -- product installer_health or a replacement for its quarantines.
  insert into public.qa_vt_submission_intents(sha256,candidate_id,winget_id,version,architecture,
    manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at,dispatch_started_at,
    dispatch_attempt,profile_sha256,github_run_id)
  values(item.sha256,c.id,c.winget_id,c.version,c.architecture,c.installer_url,c.installer_url,
    'qa-vt-terminal:'||p_preflight_lease,stamp,c.dispatched_at,c.attempts,c.package_profile_sha256,c.github_run_id)
  on conflict(sha256) do update set candidate_id=excluded.candidate_id,winget_id=excluded.winget_id,
    version=excluded.version,architecture=excluded.architecture,manifest_installer_url=excluded.manifest_installer_url,
    execution_installer_url=excluded.execution_installer_url,preflight_cache_key=excluded.preflight_cache_key,
    verified_at=excluded.verified_at,dispatch_started_at=excluded.dispatch_started_at,
    dispatch_attempt=excluded.dispatch_attempt,profile_sha256=excluded.profile_sha256,github_run_id=excluded.github_run_id,
    hash_lookup_reservation_id=null,hash_not_found_at=null
  where qa_vt_submission_intents.outcome='pending' and qa_vt_submission_intents.upload_url_reserved_at is null
    and qa_vt_submission_intents.upload_reserved_at is null and qa_vt_submission_intents.analysis_id is null
    and qa_vt_submission_intents.analysis_recorded_at is null;
  get diagnostics written=row_count;
  -- The existing admissible predicate uses statement_timestamp, which precedes
  -- this writer's clock_timestamp. Its unchanged fresh-time guard runs in the
  -- subsequent reservation RPC; this response only proves this exact insert.
  return jsonb_build_object('admitted',written=1);
end;
$$;
revoke all on function public.record_qa_vt_terminal_preflight(text,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_qa_vt_terminal_preflight(text,uuid,uuid,text,text) to anon,service_role;

CREATE OR REPLACE FUNCTION public.claim_qa_vt_metadata_recheck(p_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item public.qa_vt_metadata_rechecks%rowtype; cached public.catalog_file_reputation%rowtype;
  reservation jsonb; stamp timestamptz; submission public.qa_vt_submission_intents%rowtype; candidate public.qa_candidates%rowtype;
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
      and (q.preflight_lease_expires_at is null or q.preflight_lease_expires_at<=stamp)
      and c.finished_at is not null and c.phase='publishing'
      and c.status in ('error','passed','failed') and c.test_level='psadt-package'
      and not exists(select 1 from public.qa_vt_metadata_rechecks other
        where other.sha256=q.sha256 and other.state='leased' and other.lease_expires_at>stamp)
      and not exists(select 1 from public.qa_vt_metadata_rechecks other
        where other.sha256=q.sha256 and other.preflight_lease_expires_at>stamp)
    order by exists(select 1 from public.packaging_jobs j where j.qa_candidate_id=q.candidate_id and j.status='awaiting_qa') desc,q.retry_at,q.candidate_id limit 1 for update of q skip locked;
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
    return jsonb_build_object('stop','no_eligible_work','nextPreflight',jsonb_build_object(
      'candidateId',item.candidate_id,'runId',item.run_id,'profileSha256',item.profile_sha256,
      'sha256',item.sha256,'installerUrl',candidate.installer_url,'preflightLease',item.preflight_lease));
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
$function$

