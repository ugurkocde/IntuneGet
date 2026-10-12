-- Private durable controller state. None of this data is served by public QA.
create table public.qa_automation_state (
  id text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.qa_automation_state enable row level security;
revoke all on public.qa_automation_state from public, anon, authenticated;
grant select, insert, update, delete on public.qa_automation_state to service_role;

alter table public.qa_candidates
  add column next_retry_at timestamptz not null default '-infinity',
  add column recovery_attempts integer not null default 0 check (recovery_attempts >= 0),
  add column recovery_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(recovery_history) = 'array');

create index qa_candidates_recovery_due_idx on public.qa_candidates(next_retry_at, finished_at)
  where test_level = 'psadt-package' and status = 'error';
create index qa_candidates_latest_profile_idx
  on public.qa_candidates(winget_id, enqueued_at desc, id desc)
  where test_level = 'psadt-package' and package_profile_sha256 is not null;

-- Cooldown survives profile/packager changes and deduplicates the exact source.
create table public.qa_source_backoff (
  source_key text primary key check (source_key ~ '^[a-f0-9]{64}$'),
  failure_count integer not null check (failure_count > 0),
  next_retry_at timestamptz not null,
  last_candidate_id uuid not null references public.qa_candidates(id),
  last_attempt integer not null,
  updated_at timestamptz not null default now()
);
alter table public.qa_source_backoff enable row level security;
revoke all on public.qa_source_backoff from public, anon, authenticated;
grant select, insert, update, delete on public.qa_source_backoff to service_role;

create function public.record_qa_source_failure(p_source_key text, p_candidate_id uuid, p_attempt integer)
returns timestamptz language plpgsql security invoker set search_path = public, pg_temp as $$
declare next_check timestamptz;
begin
  insert into public.qa_source_backoff as b
    (source_key, failure_count, next_retry_at, last_candidate_id, last_attempt)
  values (p_source_key, 1, now() + interval '30 minutes', p_candidate_id, p_attempt)
  on conflict (source_key) do update
    set failure_count = b.failure_count + 1,
        next_retry_at = now() + least(interval '24 hours', interval '30 minutes' * power(2, least(b.failure_count, 6))),
        last_candidate_id = excluded.last_candidate_id,
        last_attempt = excluded.last_attempt,
        updated_at = now()
    where (b.last_candidate_id, b.last_attempt) is distinct from (excluded.last_candidate_id, excluded.last_attempt)
  returning next_retry_at into next_check;
  if next_check is null then
    select next_retry_at into next_check from public.qa_source_backoff where source_key = p_source_key;
  end if;
  return next_check;
end;
$$;
revoke all on function public.record_qa_source_failure(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.record_qa_source_failure(text, uuid, integer) to service_role;

-- One newest profile per supported demanded app, addressed by indexed app ID.
-- Callers persist the cursor only after processing the bounded page.
create function public.qa_toolchain_backfill_page(p_after text default '', p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(page) order by page.winget_id), '[]'::jsonb)
  from (
    select c.id, c.winget_id, c.version, c.architecture, c.installer_sha256,
           c.enqueued_at, c.package_profile_sha256, c.test_config, c.status, c.priority, c.demand_source
    from public.curated_apps a
    cross join lateral (
      select q.* from public.qa_candidates q
      where q.winget_id = a.winget_id and q.test_level = 'psadt-package'
        and q.package_profile_sha256 is not null
        and (q.test_config->>'profileKind' = 'catalog-default'
          or (q.test_config->>'profileKind' = 'deployment-config' and q.demand_source = 'customer'
              and q.status in ('failed','error')))
      order by q.enqueued_at desc, q.id desc limit 1
    ) c
    where a.winget_id > p_after and a.is_verified and a.is_winget_verified
      and a.app_source = 'win32' and not a.is_locale_variant
      and (exists (select 1 from public.upload_history h where h.winget_id = a.winget_id)
        or exists (select 1 from public.packaging_jobs j where j.winget_id = a.winget_id and j.status in ('awaiting_qa','qa_failed')))
    order by a.winget_id limit least(greatest(p_limit, 1), 100)
  ) page;
$$;
revoke all on function public.qa_toolchain_backfill_page(text, integer) from public, anon, authenticated;
grant execute on function public.qa_toolchain_backfill_page(text, integer) to service_role;
