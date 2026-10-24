-- Public queue projection only. The claim and all security state remain unchanged.
create function public.qa_installer_security_recheck_schedule(p_sha256 text[])
returns table(sha256 text, demand boolean, eligible_at timestamptz, malicious integer)
language sql stable security invoker set search_path = ''
as $function$
  select h.sha256, d.waiting,
    case when d.waiting then h.next_check_at
      else greatest(h.next_check_at,
        greatest(h.first_held_at, coalesce((select max(r.reserved_at)
          from public.qa_vt_requests r where r.sha256=h.sha256
            and r.operation='hash_lookup'),h.first_held_at)) + interval '7 days')
    end,
    h.malicious_verdicts
  from public.qa_installer_security_holds h
  cross join lateral (select exists (select 1 from public.packaging_jobs j
    where j.status='awaiting_qa' and j.archived_at is null
      and (lower(j.installer_sha256)=h.sha256 or exists (
        select 1 from public.qa_candidates c where c.id=j.qa_candidate_id
          and lower(c.installer_sha256)=h.sha256))) waiting) d
  where h.released_at is null and h.sha256=any(p_sha256)
    and cardinality(p_sha256) <= 1010;
$function$;
revoke all on function public.qa_installer_security_recheck_schedule(text[]) from public, anon, authenticated;
grant execute on function public.qa_installer_security_recheck_schedule(text[]) to service_role;
