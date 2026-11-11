-- Defense in depth for the public site counters.
-- Production already has row level security with a read-only policy for
-- browser roles; this makes the same guarantee explicit for every install,
-- including databases where 20261110093000 created the table.

alter table public.site_counters enable row level security;

revoke insert, update, delete, truncate on table public.site_counters from anon, authenticated;
grant select on table public.site_counters to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'site_counters' and cmd = 'SELECT'
  ) then
    create policy "Allow public read access" on public.site_counters
      for select to anon, authenticated using (true);
  end if;
end;
$$;

-- Revoke every overload of increment_counter, not only (text, integer).
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'increment_counter'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- Live landing updates subscribe to site_counters changes.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'site_counters'
     ) then
    alter publication supabase_realtime add table public.site_counters;
  end if;
end;
$$;
