-- Preparatory API only. Callers and hosted payload handling activate together.
alter table public.qa_vt_requests add column candidate_id uuid,
  add column recheck_lease uuid;
create index qa_vt_requests_candidate_idx on public.qa_vt_requests(candidate_id,operation);
create index qa_vt_requests_recheck_idx on public.qa_vt_requests(recheck_lease)
  where recheck_lease is not null;

create table public.qa_vt_submission_intents (
  sha256 text primary key check (sha256 ~ '^[a-f0-9]{64}$' and sha256 <> repeat('0',64)),
  candidate_id uuid not null,
  winget_id text not null, version text not null, architecture text not null,
  manifest_installer_url text not null, execution_installer_url text not null,
  preflight_cache_key text not null, verified_at timestamptz not null,
  upload_url_reserved_at timestamptz, upload_reserved_at timestamptz,
  analysis_id text check (analysis_id ~ '^[A-Za-z0-9=_-]{1,200}$'),
  analysis_recorded_at timestamptz,
  outcome text not null default 'pending' check (outcome in
    ('pending','submitted','ambiguous','too_large','integrity_failed'))
);
alter table public.qa_vt_submission_intents enable row level security;
revoke all on public.qa_vt_submission_intents from public,anon,authenticated,service_role;
grant select on public.qa_vt_submission_intents to service_role;

-- Only the trusted server can bind an intent after its live manifest preflight.
-- Execution URL is supplied by that server after its reviewed URL overrides,
-- and must match the service-only health row for this exact candidate tuple.
create function public.record_qa_vt_submission_intent(
  p_candidate_id uuid,p_cache_key text,p_execution_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.qa_candidates%rowtype; healthy public.installer_health%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into c from public.qa_candidates where id=p_candidate_id for update;
  if not found or c.status is distinct from 'dispatched' or c.test_level is distinct from 'psadt-package'
    or c.winget_id is null or lower(c.winget_id) like 'custom.%'
    or lower(c.winget_id) like 'intuneget.curated.%'
    or c.installer_sha256 is null or lower(c.installer_sha256) !~ '^[a-f0-9]{64}$'
    or lower(c.installer_sha256)=repeat('0',64)
    or p_execution_url is null or p_execution_url !~ '^https://[^/@[:space:]]+(/|$)'
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
    manifest_installer_url,execution_installer_url,preflight_cache_key,verified_at)
  values(lower(c.installer_sha256),c.id,c.winget_id,c.version,c.architecture,
    c.installer_url,p_execution_url,p_cache_key,healthy.checked_at)
  on conflict(sha256) do update set candidate_id=excluded.candidate_id,
    winget_id=excluded.winget_id,version=excluded.version,architecture=excluded.architecture,
    manifest_installer_url=excluded.manifest_installer_url,execution_installer_url=excluded.execution_installer_url,
    preflight_cache_key=excluded.preflight_cache_key,verified_at=excluded.verified_at
  where qa_vt_submission_intents.upload_url_reserved_at is null
    and qa_vt_submission_intents.upload_reserved_at is null;
end;
$$;
revoke all on function public.record_qa_vt_submission_intent(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_qa_vt_submission_intent(uuid,text,text) to service_role;

create function public.reserve_qa_vt_candidate_request(p_secret text,p_candidate_id uuid,
  p_sha256 text,p_operation text,p_lease uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.qa_candidates%rowtype; intent public.qa_vt_submission_intents%rowtype;
  cached public.catalog_file_reputation%rowtype; reservation jsonb; request_id uuid;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into c from public.qa_candidates where id=p_candidate_id for update;
  if not found or c.status not in ('dispatched','running') or c.test_level is distinct from 'psadt-package'
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
    if not found or intent.candidate_id is distinct from c.id then
      raise exception 'Public installer submission intent unavailable';
    end if;
    if p_operation in ('upload_url','upload') then
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
revoke all on function public.reserve_qa_vt_candidate_request(text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_qa_vt_candidate_request(text,uuid,text,text,uuid) to anon,service_role;

create function public.defer_qa_vt_candidate_requests(p_secret text,p_candidate_id uuid,
  p_reservation uuid,p_seconds integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  if not exists(select 1 from public.qa_vt_requests where id=p_reservation and candidate_id=p_candidate_id) then
    raise exception 'QA VirusTotal reservation owner rejected';
  end if;
  perform public.defer_qa_vt_requests(p_reservation,p_seconds);
end;
$$;
revoke all on function public.defer_qa_vt_candidate_requests(text,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.defer_qa_vt_candidate_requests(text,uuid,uuid,integer) to anon,service_role;

create function public.record_qa_vt_submission_analysis(p_secret text,p_candidate_id uuid,
  p_sha256 text,p_analysis_id text,p_outcome text) returns void
language plpgsql security definer set search_path = '' as $$
declare intent public.qa_vt_submission_intents%rowtype;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  if not exists(select 1 from public.qa_candidates where id=p_candidate_id
    and status in ('dispatched','running') and test_level='psadt-package'
    and lower(installer_sha256)=p_sha256) then raise exception 'QA submission candidate rejected'; end if;
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
revoke all on function public.record_qa_vt_submission_analysis(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_qa_vt_submission_analysis(text,uuid,text,text,text) to anon,service_role;

-- A cache entry may already be flagged before the first unknown report.
-- Seed the exclusion from that covered evidence without lowering its floor.
do $migration$
declare original text; definition text; anchor text;
begin
  original := replace(pg_get_functiondef('public.guard_qa_installer_security()'::regprocedure),E'\r\n',E'\n');
  anchor := 'values(lower(new.installer_sha256),0)';
  if length(original)-length(replace(original,anchor,'')) <> length(anchor) then
    raise exception 'QA unknown hold seed anchor changed';
  end if;
  definition := replace(original,anchor,$guard$values(lower(new.installer_sha256),coalesce((
    select r.malicious from public.catalog_file_reputation r
    where r.sha256=lower(new.installer_sha256) and r.status='found'
      and r.malicious between 1 and 9999 and r.suspicious between 0 and 9999
      and r.total_engines between 1 and 9999
      and r.malicious::bigint+r.suspicious::bigint <= r.total_engines),0))$guard$);
  anchor := 'malicious_verdicts = 0, released_at = null, verdict_at = now()';
  if length(definition)-length(replace(definition,anchor,'')) <> length(anchor) then
    raise exception 'QA unknown hold conflict anchor changed';
  end if;
  definition := replace(definition,anchor,'malicious_verdicts = excluded.malicious_verdicts, released_at = null, verdict_at = now()');
  execute definition;
end;
$migration$;
