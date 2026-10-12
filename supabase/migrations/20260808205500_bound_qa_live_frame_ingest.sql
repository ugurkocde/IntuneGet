-- A detached capture process must not keep an abandoned VM publicly live for
-- the full candidate-recovery window.
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
      and coalesce(started_at, dispatched_at, enqueued_at) > now() - interval '4 hours'
  );
end;
$$;

revoke all on function public.authorize_qa_live_frame_ingest(text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.authorize_qa_live_frame_ingest(text, uuid, timestamptz)
  to service_role;
