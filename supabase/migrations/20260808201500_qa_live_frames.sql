-- Private, short-lived VM console frames for the public read-only QA viewer.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qa-live-frames', 'qa-live-frames', false, 204800, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.qa_live_frames (
  candidate_id uuid primary key references public.qa_candidates(id) on delete cascade,
  object_path text not null unique,
  sequence bigint not null check (sequence >= 0),
  captured_at timestamptz not null,
  width integer not null check (width between 64 and 1920),
  height integer not null check (height between 64 and 1200),
  byte_size integer not null check (byte_size between 4 and 204800),
  updated_at timestamptz not null default now(),
  constraint qa_live_frames_object_path_check check (
    object_path ~ ('^' || candidate_id::text || '/slot-[0-2]\.jpg$')
  )
);

comment on table public.qa_live_frames is
  'Service-only pointer to the latest private Hyper-V console frame for an active QA candidate.';

alter table public.qa_live_frames enable row level security;
revoke all on table public.qa_live_frames from public, anon, authenticated;
grant select, insert, update, delete on table public.qa_live_frames to service_role;

create index if not exists qa_live_frames_stale_idx
  on public.qa_live_frames (updated_at);

create or replace function public.authorize_qa_live_frame_ingest(
  p_secret text,
  p_candidate_id uuid,
  p_captured_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  expected_secret_hash constant text := 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921';
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    return false;
  end if;

  if p_captured_at is null
    or p_captured_at < now() - interval '2 minutes'
    or p_captured_at > now() + interval '2 minutes'
  then
    return false;
  end if;

  return exists (
    select 1
    from public.qa_candidates
    where id = p_candidate_id
      and test_level = 'psadt-package'
      and status in ('dispatched', 'running')
  );
end;
$$;

revoke all on function public.authorize_qa_live_frame_ingest(text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.authorize_qa_live_frame_ingest(text, uuid, timestamptz)
  to service_role;

