-- Bind public submission provenance to the dispatch before its GitHub run exists.
-- Legacy intents remain unbound and ineligible; no evidence is backfilled.
alter table public.qa_vt_submission_intents
  add column dispatch_started_at timestamptz,
  add column dispatch_attempt integer check (dispatch_attempt >= 0),
  add column profile_sha256 text check (profile_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  add column github_run_id text check (github_run_id ~ '^[1-9][0-9]*$');

-- Internal predicate only; the existing secret-authenticated APIs own admission.
create function public.qa_vt_submission_identity(p_candidate_id uuid,p_sha256 text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.qa_vt_submission_intents i
    join public.qa_candidates c on c.id=i.candidate_id
    where c.id=p_candidate_id and i.sha256=p_sha256
      and c.test_level='psadt-package' and lower(c.installer_sha256)=i.sha256
      and c.winget_id=i.winget_id and c.version=i.version and c.architecture=i.architecture
      and c.installer_url=i.manifest_installer_url
      and c.dispatched_at=i.dispatch_started_at and c.attempts=i.dispatch_attempt
      and c.package_profile_sha256=i.profile_sha256
      and c.github_run_id ~ '^[1-9][0-9]*$'
      and (i.github_run_id is null or i.github_run_id=c.github_run_id)
      and (c.status in ('dispatched','running') or
        (c.status in ('error','failed','passed') and c.phase='publishing' and c.finished_at is not null))
      and not exists(select 1 from public.qa_candidates newer
        where lower(newer.winget_id)=lower(c.winget_id) and newer.architecture=c.architecture
          and newer.status<>'superseded' and newer.enqueued_at>c.enqueued_at
          and (lower(newer.installer_sha256) is distinct from i.sha256
            or newer.package_profile_sha256 is distinct from i.profile_sha256
            or newer.version is distinct from i.version)))
$$;
revoke all on function public.qa_vt_submission_identity(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.qa_vt_submission_identity(uuid,text) to service_role;

create function public.qa_vt_submission_admissible(p_sha256 text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.qa_vt_submission_intents i
    where i.sha256=p_sha256 and i.outcome='pending'
      and i.verified_at>statement_timestamp()-interval '6 hours'
      and i.verified_at<=statement_timestamp()
      and public.qa_vt_submission_identity(i.candidate_id,i.sha256)
      -- A known file needs a metadata lookup, never another installer upload.
      and not exists(select 1 from public.catalog_file_reputation r where r.sha256=i.sha256
        and r.status='found')
      -- Unknown holds have a zero floor and stay in place throughout submission.
      and not exists(select 1 from public.qa_installer_security_holds h
        where h.sha256=i.sha256 and h.released_at is null and h.malicious_verdicts>0)
      and not exists(select 1 from public.qa_package_blocks b
        where lower(b.winget_id)=lower(i.winget_id) and b.version=i.version
          and b.architecture=i.architecture and lower(b.installer_sha256)=i.sha256))
$$;
revoke all on function public.qa_vt_submission_admissible(text) from public,anon,authenticated,service_role;
grant execute on function public.qa_vt_submission_admissible(text) to service_role;

create or replace function public.record_qa_vt_submission_intent(
  p_candidate_id uuid,p_cache_key text,p_execution_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.qa_candidates%rowtype; healthy public.installer_health%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into c from public.qa_candidates where id=p_candidate_id for update;
  if not found or c.status is distinct from 'dispatched' or c.test_level is distinct from 'psadt-package'
    or c.winget_id is null or lower(c.winget_id) like 'custom.%'
    or lower(c.winget_id) like 'intuneget.curated.%'
    or c.dispatched_at is null or c.attempts is null
    or c.package_profile_sha256 is null or c.package_profile_sha256 !~ '^[A-Fa-f0-9]{64}$'
    or c.installer_sha256 is null or lower(c.installer_sha256) !~ '^[a-f0-9]{64}$'
    or lower(c.installer_sha256)=repeat('0',64)
    or p_execution_url is null or p_execution_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9](:443)?(/|$)'
    or split_part(substring(p_execution_url from 9),'/',1) ~ '^[0-9.]+(:443)?$'
    or lower(split_part(split_part(substring(p_execution_url from 9),'/',1),':',1)) ~ '(^localhost$|\.localhost$|\.local$|\.internal$|\.$)'
    or p_execution_url ~ '[[:space:]#]' then
    raise exception 'Public installer submission provenance rejected';
  end if;
  select * into healthy from public.installer_health where cache_key=p_cache_key;
  if not found or healthy.status is distinct from 'healthy' or healthy.expires_at is null
    or healthy.expires_at <= clock_timestamp() or healthy.checked_at is null
    or healthy.checked_at > clock_timestamp() or healthy.winget_id is distinct from c.winget_id
    or healthy.version is distinct from c.version or healthy.architecture is distinct from c.architecture
    or lower(healthy.expected_sha256) is distinct from lower(c.installer_sha256)
    or lower(healthy.actual_sha256) is distinct from lower(c.installer_sha256)
    or healthy.installer_url is distinct from p_execution_url then
    raise exception 'Public installer preflight evidence rejected';
  end if;
  insert into public.qa_vt_submission_intents(sha256,candidate_id,winget_id,version,architecture,
    manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at,dispatch_started_at,dispatch_attempt,profile_sha256,github_run_id)
  values(lower(c.installer_sha256),c.id,c.winget_id,c.version,c.architecture,
    c.installer_url,p_execution_url,p_cache_key,healthy.checked_at,c.dispatched_at,c.attempts,c.package_profile_sha256,c.github_run_id)
  on conflict(sha256) do update set candidate_id=excluded.candidate_id,
    winget_id=excluded.winget_id,version=excluded.version,architecture=excluded.architecture,
    manifest_installer_url=excluded.manifest_installer_url,execution_installer_url=excluded.execution_installer_url,
    preflight_cache_key=excluded.preflight_cache_key,verified_at=excluded.verified_at,
    dispatch_started_at=excluded.dispatch_started_at,dispatch_attempt=excluded.dispatch_attempt,
    profile_sha256=excluded.profile_sha256,github_run_id=excluded.github_run_id
  where qa_vt_submission_intents.outcome='pending'
    and qa_vt_submission_intents.upload_url_reserved_at is null
    and qa_vt_submission_intents.upload_reserved_at is null;
end;
$$;

create or replace function public.reserve_qa_vt_candidate_request(p_secret text,p_candidate_id uuid,
  p_sha256 text,p_operation text,p_lease uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.qa_candidates%rowtype; intent public.qa_vt_submission_intents%rowtype;
  cached public.catalog_file_reputation%rowtype; reservation jsonb; request_id uuid;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into c from public.qa_candidates where id=p_candidate_id for update;
  if not found or (c.status not in ('dispatched','running') and
      (p_lease is not null or p_operation not in ('upload_url','upload','analysis_lookup')
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
      and operation='hash_lookup' and recheck_lease is null)>=2 then
      raise exception 'QA VirusTotal candidate lookup budget exhausted';
    end if;
  else
    select * into intent from public.qa_vt_submission_intents where sha256=p_sha256 for update;
    if not found or intent.candidate_id is distinct from c.id
      or not public.qa_vt_submission_identity(c.id,p_sha256) then
      raise exception 'Public installer submission intent unavailable';
    end if;
    if p_operation in ('upload_url','upload') then
      if not public.qa_vt_submission_admissible(p_sha256) then
        raise exception 'Public installer submission admission rejected';
      end if;
      if intent.verified_at <= clock_timestamp()-interval '6 hours' or intent.outcome<>'pending'
        or intent.upload_reserved_at is not null
        or (p_operation='upload_url' and intent.upload_url_reserved_at is not null) then
        raise exception 'Public installer submission already reserved or stale';
      end if;
    elsif intent.upload_reserved_at is null or intent.analysis_id is null or intent.outcome<>'submitted'
      or (select count(*) from public.qa_vt_requests where candidate_id=c.id and operation='analysis_lookup')>=3 then
      raise exception 'Public installer analysis unavailable';
    end if;
  end if;
  -- Bind the server-established dispatch to the first observed GitHub run.
  if p_lease is null and p_operation in ('upload_url','upload','analysis_lookup') then
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
$$;

create or replace function public.record_qa_vt_submission_analysis(p_secret text,p_candidate_id uuid,
  p_sha256 text,p_analysis_id text,p_outcome text) returns void
language plpgsql security definer set search_path = '' as $$
declare intent public.qa_vt_submission_intents%rowtype;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  if not public.qa_vt_submission_identity(p_candidate_id,p_sha256) then raise exception 'QA submission candidate rejected'; end if;
  select * into intent from public.qa_vt_submission_intents where sha256=p_sha256
    and candidate_id=p_candidate_id for update;
  if not found or intent.outcome<>'pending'
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
      where i.upload_url_reserved_at is null and i.upload_reserved_at is null
        and public.qa_vt_submission_admissible(i.sha256)
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

-- CREATE OR REPLACE preserves the existing four API signatures and ACLs.
