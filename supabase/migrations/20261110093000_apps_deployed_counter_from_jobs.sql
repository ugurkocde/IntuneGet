-- The public "apps deployed" counter follows successful packaging jobs.
-- Before this change the browser bumped it on every Deploy click, before
-- sign-in or packaging, and anonymous callers could add any amount through
-- increment_counter. The counter had drifted to more than twice the number of
-- jobs that actually reached Intune.

create table if not exists public.site_counters (
  id text primary key,
  value bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Counters are adjusted by the server (service role) and by the trigger below,
-- never directly by browser clients.
do $$
begin
  if to_regprocedure('public.increment_counter(text, integer)') is not null then
    revoke execute on function public.increment_counter(text, integer) from public, anon, authenticated;
    grant execute on function public.increment_counter(text, integer) to service_role;
  end if;
end;
$$;

create or replace function public.track_apps_deployed_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  delta integer := 0;
begin
  if new.status = 'deployed' and (tg_op = 'INSERT' or old.status is distinct from 'deployed') then
    delta := 1;
  elsif tg_op = 'UPDATE' and old.status = 'deployed' and new.status is distinct from 'deployed' then
    delta := -1;
  end if;

  if delta <> 0 then
    insert into public.site_counters as counter (id, value, updated_at)
    values ('apps_deployed', greatest(delta, 0), now())
    on conflict (id) do update
      set value = greatest(counter.value + delta, 0),
          updated_at = now();
  end if;

  return null;
end;
$$;

revoke execute on function public.track_apps_deployed_counter() from public, anon, authenticated;

drop trigger if exists packaging_jobs_track_apps_deployed on public.packaging_jobs;
create trigger packaging_jobs_track_apps_deployed
  after insert or update of status on public.packaging_jobs
  for each row execute function public.track_apps_deployed_counter();

-- Restate the counter from the jobs that actually deployed.
insert into public.site_counters as counter (id, value, updated_at)
values (
  'apps_deployed',
  (select count(*) from public.packaging_jobs where status = 'deployed'),
  now()
)
on conflict (id) do update
  set value = excluded.value,
      updated_at = excluded.updated_at;
