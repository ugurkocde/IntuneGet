-- One fixed Reader scan before 21:00 UTC. No admission, lifecycle, hold or ACL changes.
-- The lookup consumes one of the later ordinary candidate's two hash lookups.
begin;
do $migration$
declare
  target regprocedure := 'public.reserve_qa_vt_candidate_request(text,uuid,text,text,uuid)'::regprocedure;
  source text := pg_get_functiondef(target);
  needle text := $anchor$  select * into c from public.qa_candidates where id=p_candidate_id for update;
$anchor$;
  guard text := $guard$  -- Scan-only reservation: never dispatch, admit, upload or mutate the held candidate.
  if p_lease is null and p_operation='hash_lookup'
    and p_candidate_id='de979d31-562f-40ef-9dd1-3752fa091953' and c.status='queued' then
    if c.winget_id is distinct from 'Adobe.Acrobat.Reader.64-bit'
      or c.version is distinct from '26.003.22075' or c.architecture is distinct from 'x64'
      or c.test_level is distinct from 'psadt-package'
      or lower(c.installer_sha256) is distinct from '7bec66953457f6bc78bce9f0a1dcdde1c4cf2a8f8ac26f73fcecf5738f42f307'
      or upper(c.package_profile_sha256) is distinct from 'BE9876C429C9ADB461675ADC80E58E7890A7F5F41C26275BDD3DDA694C48CDCA'
      or p_sha256 is distinct from lower(c.installer_sha256)
      or clock_timestamp() >= '2026-11-11 21:00:00+00'::timestamptz
      or not exists(select 1 from public.qa_installer_security_holds
        where sha256=p_sha256 and released_at is null and malicious_verdicts=0)
      or exists(select 1 from public.catalog_file_reputation where sha256=p_sha256 and status='found')
      or exists(select 1 from public.qa_vt_requests where sha256=p_sha256
        and operation='hash_lookup' and candidate_id=c.id and recheck_lease is null
        and reserved_at >= '2026-11-11 00:00:00+00'::timestamptz) then
      raise exception 'QA VirusTotal scan-only binding rejected';
    end if;
    reservation := public.reserve_qa_vt_request(p_sha256,'hash_lookup');
    request_id := (reservation->>'reservationId')::uuid;
    if request_id is not null then
      update public.qa_vt_requests set candidate_id=c.id where id=request_id;
    end if;
    return reservation;
  end if;
$guard$;
  before_properties jsonb; after_properties jsonb;
begin
  if encode(extensions.digest(source,'sha256'),'hex') <> 'd82f5cd1df5c869f330f267988052c6c9d0bd2f82a705d4430fcb41b3d19455c' then
    raise exception 'Reader scan-only source pin mismatch';
  end if;
  if (length(source)-length(replace(source,needle,'')))/length(needle) <> 1 then
    raise exception 'Reader scan-only anchor mismatch';
  end if;
  select jsonb_build_array(proowner,proacl::text,prosecdef,proconfig,provolatile)
    into before_properties from pg_proc where oid=target;
  execute replace(source,needle,needle||guard);
  select jsonb_build_array(proowner,proacl::text,prosecdef,proconfig,provolatile)
    into after_properties from pg_proc where oid=target;
  if after_properties is distinct from before_properties
    or replace(pg_get_functiondef(target),guard,'') is distinct from source then
    raise exception 'Reader scan-only changed unrelated function properties';
  end if;
end;
$migration$;
do $migration$
declare
  target regprocedure := 'public.report_qa_vt_candidate_rate_limit(text,uuid,uuid,timestamptz)'::regprocedure;
  source text := pg_get_functiondef(target);
  needle text := $anchor$  select * into c from public.qa_candidates where id=p_candidate_id for update;
$anchor$;
  guard text := $guard$  -- A valid scan reservation must still propagate Retry-After after the window closes.
  -- It has no ordinary lifecycle run, so do not create a metadata replay row.
  if p_candidate_id='de979d31-562f-40ef-9dd1-3752fa091953' and c.status='queued' then
    if c.winget_id is distinct from 'Adobe.Acrobat.Reader.64-bit'
      or c.version is distinct from '26.003.22075' or c.architecture is distinct from 'x64'
      or c.test_level is distinct from 'psadt-package'
      or lower(c.installer_sha256) is distinct from '7bec66953457f6bc78bce9f0a1dcdde1c4cf2a8f8ac26f73fcecf5738f42f307'
      or upper(c.package_profile_sha256) is distinct from 'BE9876C429C9ADB461675ADC80E58E7890A7F5F41C26275BDD3DDA694C48CDCA'
      or not exists(select 1 from public.qa_vt_requests where id=p_reservation
        and candidate_id=c.id and sha256=lower(c.installer_sha256)
        and operation='hash_lookup' and recheck_lease is null
        and reserved_at >= '2026-11-11 00:00:00+00'::timestamptz
        and reserved_at < '2026-11-11 21:00:00+00'::timestamptz) then
      raise exception 'QA VirusTotal scan-only rate limit binding rejected';
    end if;
    perform public.defer_qa_vt_requests_until(p_reservation,p_retry_at);
    return;
  end if;
$guard$;
  before_properties jsonb; after_properties jsonb;
begin
  if encode(extensions.digest(source,'sha256'),'hex') <> 'ffaaf313f296124c509c6e0bd38c2827df2a54a3a403488eb723ca296bb89e7f' then
    raise exception 'Reader scan-only source pin mismatch';
  end if;
  if (length(source)-length(replace(source,needle,'')))/length(needle) <> 1 then
    raise exception 'Reader scan-only anchor mismatch';
  end if;
  select jsonb_build_array(proowner,proacl::text,prosecdef,proconfig,provolatile)
    into before_properties from pg_proc where oid=target;
  execute replace(source,needle,needle||guard);
  select jsonb_build_array(proowner,proacl::text,prosecdef,proconfig,provolatile)
    into after_properties from pg_proc where oid=target;
  if after_properties is distinct from before_properties
    or replace(pg_get_functiondef(target),guard,'') is distinct from source then
    raise exception 'Reader scan-only changed unrelated function properties';
  end if;
end;
$migration$;
commit;
