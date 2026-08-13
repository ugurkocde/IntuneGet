-- Monitor the complete supported WinGet catalog without duplicating every app
-- as a hand-authored QA recipe. Catalog candidates carry a small, validated
-- test configuration and may omit a repository definition path.

alter table public.qa_candidates
  drop constraint if exists qa_candidates_winget_id_fkey;

alter table public.qa_candidates
  alter column definition_path drop not null,
  add column if not exists test_config jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qa_candidates_test_config_object_check'
      and conrelid = 'public.qa_candidates'::regclass
  ) then
    alter table public.qa_candidates
      add constraint qa_candidates_test_config_object_check
      check (jsonb_typeof(test_config) = 'object');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'qa_candidates_winget_id_fkey'
      and conrelid = 'public.qa_candidates'::regclass
  ) then
    alter table public.qa_candidates
      add constraint qa_candidates_winget_id_fkey
      foreign key (winget_id)
      references public.curated_apps(winget_id)
      on update cascade;
  end if;
end $$;

create index if not exists curated_apps_qa_eligible_idx
  on public.curated_apps(winget_id)
  where is_verified = true
    and is_winget_verified = true
    and app_source = 'win32'
    and is_locale_variant = false;

create table if not exists public.qa_winget_poll_state (
  id text primary key check (id = 'microsoft/winget-pkgs'),
  head_sha text check (head_sha is null or head_sha ~ '^[a-f0-9]{40}$'),
  last_checked_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.qa_winget_poll_state is
  'Private durable cursor for the WinGet repository change feed used by catalog-wide QA.';

insert into public.qa_winget_poll_state(id)
values ('microsoft/winget-pkgs')
on conflict (id) do nothing;

alter table public.qa_winget_poll_state enable row level security;
revoke all on table public.qa_winget_poll_state from public, anon, authenticated;
grant select, insert, update on table public.qa_winget_poll_state to service_role;

alter table public.qa_poll_runs
  add column if not exists base_sha text,
  add column if not exists head_sha text,
  add column if not exists changed_package_count integer not null default 0,
  add column if not exists supported_changed_count integer not null default 0;

comment on column public.qa_poll_runs.recipe_count is
  'Count of canonical Win32 catalog apps covered by QA monitoring for this poll.';
