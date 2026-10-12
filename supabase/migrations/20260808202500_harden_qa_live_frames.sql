-- Preserve stale metadata long enough for the hourly storage sweeper even if a
-- candidate row is removed, and serialize latest-frame publication in SQL.
alter table public.qa_live_frames
  drop constraint if exists qa_live_frames_candidate_id_fkey;

create or replace function public.publish_qa_live_frame_metadata(
  p_secret text,
  p_candidate_id uuid,
  p_object_path text,
  p_sequence bigint,
  p_captured_at timestamptz,
  p_width integer,
  p_height integer,
  p_byte_size integer
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  updated_count integer;
begin
  if not public.authorize_qa_live_frame_ingest(p_secret, p_candidate_id, p_captured_at) then
    return false;
  end if;

  insert into public.qa_live_frames (
    candidate_id, object_path, sequence, captured_at, width, height, byte_size, updated_at
  ) values (
    p_candidate_id, p_object_path, p_sequence, p_captured_at, p_width, p_height, p_byte_size, now()
  )
  on conflict (candidate_id) do update set
    object_path = excluded.object_path,
    sequence = excluded.sequence,
    captured_at = excluded.captured_at,
    width = excluded.width,
    height = excluded.height,
    byte_size = excluded.byte_size,
    updated_at = now()
  where excluded.sequence > public.qa_live_frames.sequence;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.authorize_qa_live_frame_cleanup(
  p_secret text,
  p_candidate_id uuid
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

  return exists (
    select 1 from public.qa_live_frames where candidate_id = p_candidate_id
  ) or exists (
    select 1 from public.qa_candidates where id = p_candidate_id
  );
end;
$$;

revoke all on function public.publish_qa_live_frame_metadata(text, uuid, text, bigint, timestamptz, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.publish_qa_live_frame_metadata(text, uuid, text, bigint, timestamptz, integer, integer, integer)
  to service_role;

revoke all on function public.authorize_qa_live_frame_cleanup(text, uuid)
  from public, anon, authenticated;
grant execute on function public.authorize_qa_live_frame_cleanup(text, uuid)
  to service_role;

