-- Exact installed dependency metadata only. No upload or lifecycle permission.
create table public.qa_vt_dependency_demands (
  candidate_id uuid not null references public.qa_candidates(id),
  run_id text not null check(run_id ~ '^[1-9][0-9]*$'),
  run_attempt integer not null check(run_attempt>0),
  profile_sha256 text not null check(profile_sha256 ~ '^[A-F0-9]{64}$'),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$' and sha256<>repeat('0',64)),
  package_identifier text not null,
  dep_order integer not null check(dep_order between 1 and 8),
  first_queued_at timestamptz not null default clock_timestamp(),
  primary key(candidate_id,run_id,run_attempt,sha256)
);
create table public.qa_vt_dependency_rechecks (
  sha256 text primary key check(sha256 ~ '^[a-f0-9]{64}$' and sha256<>repeat('0',64)),
  state text not null default 'pending' check(state in ('pending','leased','resolved','not_found','escalated')),
  first_queued_at timestamptz not null default clock_timestamp(),
  retry_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check(attempts between 0 and 6),
  lease uuid, lease_expires_at timestamptz, reservation_id uuid,
  last_http_status integer check(last_http_status between 0 and 599)
);
create index qa_vt_dependency_rechecks_due on public.qa_vt_dependency_rechecks(retry_at)
  where state in ('pending','leased');
alter table public.qa_vt_dependency_demands enable row level security;
alter table public.qa_vt_dependency_rechecks enable row level security;
revoke all on public.qa_vt_dependency_demands,public.qa_vt_dependency_rechecks from public,anon,authenticated,service_role;
grant select on public.qa_vt_dependency_demands,public.qa_vt_dependency_rechecks to service_role;

-- This revalidates stored receipt ownership on admission AND claim. The URL is
-- only an HTTPS consistency check: it is never returned or fetched by this lane.
create function public.qa_vt_installed_dependency_entries(p_candidate_id uuid)
returns table(run_id text,run_attempt integer,profile_sha256 text,sha256 text,package_identifier text,dep_order integer)
language plpgsql stable security invoker set search_path='' as $$
declare c public.qa_candidates%rowtype; r public.qa_dependency_execution_receipts%rowtype;
  canonical jsonb; entry jsonb; dep jsonb; transport jsonb; position integer;
begin
  select * into c from public.qa_candidates where id=p_candidate_id;
  if not found or not public.qa_vt_terminal_identity(c.id)
    or c.finished_at<statement_timestamp()-interval '14 days'
    or not exists(select 1 from public.packaging_jobs j where j.qa_candidate_id=c.id and j.status='awaiting_qa')
    or c.test_config->>'packageProfileCanonicalJson' is null
    or upper(encode(extensions.digest(c.test_config->>'packageProfileCanonicalJson','sha256'),'hex'))
      is distinct from c.package_profile_sha256 then return;end if;
  select e.* into r from public.qa_dependency_execution_receipts e
    where e.candidate_id=c.id and e.run_id=c.github_run_id
    order by e.run_attempt desc limit 1;
  if not found or r.lifecycle_outcome<>'Passed' or r.profile_sha256 is distinct from c.package_profile_sha256
    or r.recorded_at<c.dispatched_at or r.recorded_at>c.finished_at
    or r.receipt->>'sha256' is distinct from r.receipt_sha256
    or r.receipt->>'packageContentSha256' is distinct from r.content_sha256 then return;end if;
  canonical:=(c.test_config->>'packageProfileCanonicalJson')::jsonb;
  if canonical#>>'{app,wingetId}' is distinct from c.winget_id
    or canonical#>>'{app,version}' is distinct from c.version
    or canonical#>>'{app,architecture}' is distinct from c.architecture
    or upper(canonical#>>'{installer,sha256}') is distinct from upper(c.installer_sha256)
    or jsonb_typeof(canonical#>'{installer,packageDependencies}') is distinct from 'array'
    or jsonb_typeof(r.receipt->'entries') is distinct from 'array'
    or jsonb_typeof(c.test_config->'packageDependencies') is distinct from 'array'
    or jsonb_array_length(canonical#>'{installer,packageDependencies}') not between 1 and 8
    or jsonb_array_length(canonical#>'{installer,packageDependencies}')<>jsonb_array_length(r.receipt->'entries')
    or jsonb_array_length(canonical#>'{installer,packageDependencies}')<>jsonb_array_length(c.test_config->'packageDependencies') then return;end if;
  for entry,position in select value,ordinality::integer from jsonb_array_elements(r.receipt->'entries') with ordinality loop
    dep:=canonical#>'{installer,packageDependencies}'->(position-1);
    transport:=c.test_config->'packageDependencies'->(position-1);
    if entry->>'classification'='installed' and entry->>'exitCode' in ('0','3010')
      and entry->'order'=to_jsonb(position) and dep->'order'=to_jsonb(position) and transport->'order'=to_jsonb(position)
      and entry->>'sha256' ~ '^[A-F0-9]{64}$' and entry->>'sha256'<>repeat('0',64)
      and lower(entry->>'sha256')<>lower(c.installer_sha256)
      and entry->>'sha256'=dep->>'sha256' and entry->>'sha256'=upper(transport->>'installerSha256')
      and entry->>'packageIdentifier'=dep->>'packageIdentifier' and entry->>'packageIdentifier'=transport->>'packageIdentifier'
      and entry->>'version'=dep->>'version' and entry->>'version'=transport->>'version'
      and entry->>'architecture'=dep->>'architecture' and entry->>'architecture'=transport->>'architecture'
      and transport->>'installerUrl' ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$'
      then
      run_id:=r.run_id;run_attempt:=r.run_attempt;profile_sha256:=r.profile_sha256;
      sha256:=lower(entry->>'sha256');package_identifier:=entry->>'packageIdentifier';dep_order:=position;
      return next;
    end if;
  end loop;
exception when invalid_text_representation then return;
end;
$$;
revoke all on function public.qa_vt_installed_dependency_entries(uuid) from public,anon,authenticated,service_role;
grant execute on function public.qa_vt_installed_dependency_entries(uuid) to service_role;

create function public.admit_qa_vt_dependency_rechecks(p_secret text) returns integer
language plpgsql security definer set search_path='' as $$
declare written integer;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  insert into public.qa_vt_dependency_demands(candidate_id,run_id,run_attempt,profile_sha256,sha256,package_identifier,dep_order)
    select c.id,e.run_id,e.run_attempt,e.profile_sha256,e.sha256,e.package_identifier,e.dep_order
    from public.qa_candidates c cross join lateral public.qa_vt_installed_dependency_entries(c.id) e
    where not exists(select 1 from public.qa_vt_dependency_demands d where d.candidate_id=c.id and d.run_id=e.run_id and d.run_attempt=e.run_attempt and d.sha256=e.sha256)
    order by c.finished_at,c.id,e.dep_order limit 100
    on conflict(candidate_id,run_id,run_attempt,sha256) do nothing;
  get diagnostics written=row_count;
  insert into public.qa_vt_dependency_rechecks(sha256)
    select distinct d.sha256 from public.qa_vt_dependency_demands d
    where exists(select 1 from public.qa_vt_installed_dependency_entries(d.candidate_id) e
      where e.run_id=d.run_id and e.run_attempt=d.run_attempt and e.profile_sha256=d.profile_sha256 and e.sha256=d.sha256)
    on conflict(sha256) do nothing;
  return written;
end;
$$;

create function public.qa_vt_dependency_coverage(p_candidate_id uuid) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare c public.qa_candidates%rowtype; canonical jsonb; dep jsonb; cached public.catalog_file_reputation%rowtype;
begin
  select * into c from public.qa_candidates where id=p_candidate_id;
  if not found or c.test_config->>'packageProfileCanonicalJson' is null or
    upper(encode(extensions.digest(c.test_config->>'packageProfileCanonicalJson','sha256'),'hex')) is distinct from c.package_profile_sha256 then return false;end if;
  canonical:=(c.test_config->>'packageProfileCanonicalJson')::jsonb;
  if canonical#>'{installer,packageDependencies}' is null then return true;end if;
  if jsonb_typeof(canonical#>'{installer,packageDependencies}')<>'array' or jsonb_array_length(canonical#>'{installer,packageDependencies}')>8 then return false;end if;
  for dep in select value from jsonb_array_elements(canonical#>'{installer,packageDependencies}') loop
    select * into cached from public.catalog_file_reputation where catalog_file_reputation.sha256=lower(dep->>'sha256');
    if not found or cached.status is distinct from 'found' or cached.engine_count_version is distinct from 2
      or cached.malicious is distinct from 0 or cached.suspicious is distinct from 0
      or cached.total_engines is null or cached.total_engines not between 1 and 9999
      or cached.checked_at is null or cached.checked_at<=statement_timestamp()-interval '7 days' or cached.checked_at>statement_timestamp()
      or cached.analyzed_at is null or cached.analyzed_at>statement_timestamp()
      or cached.retry_after is null or cached.retry_after<=statement_timestamp()
      or exists(select 1 from public.qa_installer_security_holds h where h.sha256=cached.sha256 and h.released_at is null) then return false;end if;
  end loop;
  return true;
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.qa_vt_dependency_coverage(uuid) from public,anon,authenticated,service_role;
grant execute on function public.qa_vt_dependency_coverage(uuid) to service_role;

create function public.claim_qa_vt_dependency_recheck(p_secret text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.qa_vt_dependency_rechecks%rowtype; reservation jsonb; stamp timestamptz:=clock_timestamp();
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  update public.qa_vt_dependency_rechecks set state='escalated',lease=null,lease_expires_at=null
    where state in ('pending','leased') and (attempts>=6 or first_queued_at<stamp-interval '14 days')
      and (lease_expires_at is null or lease_expires_at<=stamp);
  select q.* into item from public.qa_vt_dependency_rechecks q where q.state in ('pending','leased') and q.retry_at<=stamp
    and (q.lease_expires_at is null or q.lease_expires_at<=stamp)
    and exists(select 1 from public.qa_vt_dependency_demands d
      cross join lateral public.qa_vt_installed_dependency_entries(d.candidate_id) e
      where d.sha256=q.sha256 and e.sha256=d.sha256 and e.run_id=d.run_id and e.run_attempt=d.run_attempt and e.profile_sha256=d.profile_sha256)
    and not exists(select 1 from public.qa_vt_metadata_rechecks m where m.sha256=q.sha256
      and (m.lease_expires_at>stamp or m.preflight_lease_expires_at>stamp))
    order by q.retry_at,q.first_queued_at,q.sha256 limit 1 for update skip locked;
  if not found then return jsonb_build_object('stop','no_eligible_work');end if;
  if exists(select 1 from public.catalog_file_reputation r where r.sha256=item.sha256 and r.status='found'
    and r.engine_count_version=2 and r.malicious between 0 and 9999 and r.suspicious between 0 and 9999
    and r.total_engines between 1 and 9999 and r.malicious::bigint+r.suspicious::bigint<=r.total_engines
    and r.analyzed_at<=stamp and r.checked_at>stamp-interval '7 days' and r.checked_at<=stamp and r.retry_after>stamp) then
    update public.qa_vt_dependency_rechecks set state='resolved',lease=null,lease_expires_at=null,last_http_status=200 where sha256=item.sha256;
    return jsonb_build_object('cached',true,'sha256',item.sha256);
  end if;
  reservation:=public.reserve_qa_vt_request(item.sha256,'hash_lookup');
  if reservation->>'reservationId' is null then
    update public.qa_vt_dependency_rechecks set state='pending',lease=null,lease_expires_at=null,
      retry_at=greatest(retry_at,(reservation->>'retryAt')::timestamptz) where sha256=item.sha256;
    return reservation;
  end if;
  update public.qa_vt_dependency_rechecks set state='leased',lease=gen_random_uuid(),lease_expires_at=stamp+interval '2 minutes',
    attempts=attempts+1,reservation_id=(reservation->>'reservationId')::uuid where sha256=item.sha256 returning * into item;
  return jsonb_build_object('sha256',item.sha256,'lease',item.lease,'reservationId',item.reservation_id);
end;
$$;

create function public.complete_qa_vt_dependency_recheck(p_secret text,p_lease uuid,p_http_status integer,
  p_retry_at timestamptz default null,p_malicious integer default null,p_suspicious integer default null,
  p_total_engines integer default null,p_analyzed_at timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
declare item public.qa_vt_dependency_rechecks%rowtype; cached public.catalog_file_reputation%rowtype; stamp timestamptz:=clock_timestamp();
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into item from public.qa_vt_dependency_rechecks where lease=p_lease and state='leased' for update;
  if not found or p_http_status is null or p_http_status not between 0 and 599
    or (item.lease_expires_at<=stamp and p_http_status<>429) then raise exception 'QA dependency metadata lease rejected';end if;
  if p_http_status=200 then
    if p_malicious is null or p_suspicious is null or p_total_engines is null
      or p_malicious not between 0 and 9999 or p_suspicious not between 0 and 9999
      or p_total_engines not between 1 and 9999 or p_malicious::bigint+p_suspicious::bigint>p_total_engines
      or p_analyzed_at is null or not isfinite(p_analyzed_at) or p_analyzed_at>stamp then raise exception 'Invalid dependency metadata verdict';end if;
    insert into public.catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,engine_count_version,analyzed_at,checked_at,retry_after)
      values(item.sha256,'found',p_malicious,p_suspicious,p_total_engines,2,p_analyzed_at,stamp,stamp+interval '7 days')
      on conflict(sha256) do update set status=excluded.status,malicious=excluded.malicious,suspicious=excluded.suspicious,
        total_engines=excluded.total_engines,engine_count_version=2,analyzed_at=excluded.analyzed_at,checked_at=excluded.checked_at,retry_after=excluded.retry_after
      where excluded.analyzed_at>=coalesce(catalog_file_reputation.analyzed_at,'-infinity'::timestamptz)
        and excluded.checked_at>=coalesce(catalog_file_reputation.checked_at,'-infinity'::timestamptz);
    select * into cached from public.catalog_file_reputation where sha256=item.sha256;
    if not found or cached.status is distinct from 'found' or cached.engine_count_version is distinct from 2
      or cached.malicious is null or cached.suspicious is null or cached.total_engines is null
      or cached.malicious not between 0 and 9999 or cached.suspicious not between 0 and 9999
      or cached.total_engines not between 1 and 9999 or cached.malicious::bigint+cached.suspicious::bigint>cached.total_engines
      or cached.analyzed_at is null or cached.analyzed_at>stamp or cached.checked_at is null
      or cached.checked_at<=stamp-interval '7 days' or cached.checked_at>stamp or cached.retry_after is null or cached.retry_after<=stamp
      then raise exception 'Newer dependency cache evidence is not qualified';end if;
    -- Positive dependency verdicts hold this exact hash. Never relabel the
    -- main installer or mutate customer status, lifecycle or terminal retries.
    if cached.malicious>0 then
      insert into public.qa_installer_security_holds(sha256,malicious_verdicts)
        values(item.sha256,cached.malicious) on conflict(sha256) do update set
        malicious_verdicts=greatest(qa_installer_security_holds.malicious_verdicts,excluded.malicious_verdicts),released_at=null;
    end if;
    update public.qa_vt_dependency_rechecks set state='resolved',last_http_status=200,lease=null,lease_expires_at=null where sha256=item.sha256;
  else
    if p_retry_at is not null and (not isfinite(p_retry_at) or p_retry_at<=stamp or p_retry_at>stamp+interval '31 days') then raise exception 'Invalid dependency retry deadline';end if;
    p_retry_at:=greatest(p_retry_at,stamp+interval '15 minutes');
    if p_http_status=429 then perform public.defer_qa_vt_requests_until(item.reservation_id,p_retry_at);end if;
    update public.qa_vt_dependency_rechecks set state=case when p_http_status=404 then 'not_found' else 'pending' end,
      last_http_status=p_http_status,retry_at=greatest(retry_at,p_retry_at),lease=null,lease_expires_at=null where sha256=item.sha256;
  end if;
  update public.qa_vt_requests set response_recorded_at=stamp where id=item.reservation_id
    and sha256=item.sha256 and operation='hash_lookup' and response_recorded_at is null;
end;
$$;
revoke all on function public.admit_qa_vt_dependency_rechecks(text),public.claim_qa_vt_dependency_recheck(text),
  public.complete_qa_vt_dependency_recheck(text,uuid,integer,timestamptz,integer,integer,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admit_qa_vt_dependency_rechecks(text),public.claim_qa_vt_dependency_recheck(text),
  public.complete_qa_vt_dependency_recheck(text,uuid,integer,timestamptz,integer,integer,integer,timestamptz) to anon,service_role;
