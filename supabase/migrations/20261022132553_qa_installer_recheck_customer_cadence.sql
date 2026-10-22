-- No-demand held hashes use a weekly provider cadence. Awaiting demand
-- removes only that filter; the existing daily/backoff floor remains intact.
set local lock_timeout = '2s';
create index qa_vt_requests_hash_lookup_idx
  on public.qa_vt_requests (sha256, reserved_at) where operation = 'hash_lookup';

CREATE OR REPLACE FUNCTION public.claim_qa_installer_security_rechecks(p_secret text, p_candidate_id uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare held public.qa_installer_security_holds%rowtype; claimed jsonb := '[]'; lease uuid;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  if not exists (select 1 from public.qa_candidates where id=p_candidate_id
    and test_level='psadt-package' and status in ('dispatched','running')) then
    raise exception 'Daily installer lookup requires an active QA run';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5 then raise exception 'Invalid daily lookup limit'; end if;
  for held in select h.* from public.qa_installer_security_holds h
    where released_at is null and next_check_at <= now()
      -- checked_at is also written by cache refreshes, without a provider call.
      -- The immutable metered lookup ledger is the weekly cadence anchor.
      and (exists (select 1 from public.packaging_jobs j
        where j.status='awaiting_qa' and j.archived_at is null
          and (lower(j.installer_sha256)=h.sha256 or exists (
            select 1 from public.qa_candidates c where c.id=j.qa_candidate_id
              and lower(c.installer_sha256)=h.sha256)))
        or greatest(h.first_held_at,coalesce((select max(r.reserved_at)
          from public.qa_vt_requests r where r.sha256=h.sha256
            and r.operation='hash_lookup'),h.first_held_at)) <= now()-interval '7 days')
      and exists (select 1 from public.qa_candidates c where lower(c.installer_sha256)=h.sha256
        and c.test_level='psadt-package' and c.status <> 'superseded')
    order by (select max(c.priority) from public.qa_candidates c where lower(c.installer_sha256)=h.sha256) desc nulls last,
      next_check_at,sha256 limit p_limit for update of h skip locked
  loop
    lease := gen_random_uuid();
    update public.qa_installer_security_holds set next_check_at=now()+interval '24 hours',
      checked_at=now(),recheck_lease=lease,recheck_lease_expires_at=now()+interval '10 minutes'
      where sha256=held.sha256;
    update public.qa_candidates set next_retry_at=next_retry_at
      where lower(installer_sha256)=held.sha256 and status in ('queued','error');
    claimed := claimed || jsonb_build_array(jsonb_build_object('sha256',held.sha256,'lease',lease));
  end loop;
  return claimed;
end;
$function$
