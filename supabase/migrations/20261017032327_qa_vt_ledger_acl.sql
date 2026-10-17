-- Replace inherited table grants with the reviewed invoker RPC requirements.
revoke all on public.qa_vt_requests, public.qa_vt_request_budget from service_role;
grant select, insert on public.qa_vt_requests to service_role;
grant select, update on public.qa_vt_request_budget to service_role;

-- Service callers can extend a block, but cannot erase it or move the start
-- of metering. The table owner retains the guarded bootstrap/release path.
create function public.guard_qa_vt_request_budget() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user is distinct from (
      select pg_catalog.pg_get_userbyid(c.relowner)
      from pg_catalog.pg_class c where c.oid = tg_relid)
    and (new.id is distinct from old.id
      or new.metering_started_at is distinct from old.metering_started_at
      or (old.blocked_until is not null and
        (new.blocked_until is null or new.blocked_until < old.blocked_until))) then
    raise exception 'VirusTotal request budget may only be extended';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_qa_vt_request_budget()
  from public, anon, authenticated, service_role;
create trigger qa_vt_request_budget_monotonic
  before update on public.qa_vt_request_budget
  for each row execute function public.guard_qa_vt_request_budget();

-- Do not silently activate against a different role, ACL or column grant.
do $acl$
declare t record; rights text[];
begin
  for t in select c.oid,c.relname,c.relowner,c.relacl
    from pg_catalog.pg_class c where c.oid in (
      'public.qa_vt_requests'::regclass,'public.qa_vt_request_budget'::regclass)
  loop
    if pg_catalog.pg_get_userbyid(t.relowner) is distinct from current_user then
      raise exception 'VirusTotal ledger migration requires the table owner';
    end if;
    if exists(select 1 from pg_catalog.aclexplode(t.relacl) a
      where a.grantee<>t.relowner and
        (a.grantee<>'service_role'::regrole or a.is_grantable)) then
      raise exception 'Unexpected VirusTotal ledger grant';
    end if;
    select array_agg(a.privilege_type order by a.privilege_type) into rights
      from pg_catalog.aclexplode(t.relacl) a
      where a.grantee='service_role'::regrole;
    if rights is distinct from (case when t.relname='qa_vt_requests'
      then array['INSERT','SELECT'] else array['SELECT','UPDATE'] end) then
      raise exception 'Unexpected VirusTotal ledger privileges';
    end if;
    if exists(select 1 from pg_catalog.pg_attribute a
      where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
        and cardinality(a.attacl)>0) then
      raise exception 'Unexpected VirusTotal ledger column grant';
    end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_trigger g
    where g.tgrelid='public.qa_vt_request_budget'::regclass
      and g.tgname='qa_vt_request_budget_monotonic' and g.tgenabled='O'
      and g.tgtype=19 and not g.tgisinternal
      and g.tgfoid='public.guard_qa_vt_request_budget()'::regprocedure) then
    raise exception 'VirusTotal budget guard is not enabled';
  end if;
end;
$acl$;
