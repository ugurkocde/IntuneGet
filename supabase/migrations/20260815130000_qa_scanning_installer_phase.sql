-- The VirusTotal reputation lookup is now a first-class live QA phase. It runs
-- on the host between marking the candidate running and package preparation,
-- so the public live timeline can show the security check as its own step.
alter table public.qa_candidates
  drop constraint if exists qa_candidates_phase_check;

alter table public.qa_candidates
  add constraint qa_candidates_phase_check check (
    phase is null or phase in (
      'queued',
      'scanning_installer',
      'preparing_package',
      'restoring_vm',
      'installing',
      'detecting_install',
      'uninstalling',
      'verifying_removal',
      'publishing'
    )
  );

create or replace function public.publish_qa_candidate_phase(
  p_secret text,
  p_candidate_id uuid,
  p_phase text,
  p_observed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  expected_secret_hash constant text := 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921';
  updated_count integer;
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;

  if p_phase is null or p_phase not in (
    'queued',
    'scanning_installer',
    'preparing_package',
    'restoring_vm',
    'installing',
    'detecting_install',
    'uninstalling',
    'verifying_removal',
    'publishing'
  ) then
    raise exception 'Invalid QA candidate phase';
  end if;

  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    raise exception 'Invalid QA phase observation time';
  end if;

  update public.qa_candidates
  set
    phase_started_at = case
      when phase is distinct from p_phase then p_observed_at
      else phase_started_at
    end,
    phase = p_phase,
    phase_updated_at = p_observed_at,
    updated_at = greatest(updated_at, p_observed_at)
  where id = p_candidate_id
    and status in ('dispatched', 'running')
    and (phase_updated_at is null or p_observed_at > phase_updated_at);

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.publish_qa_candidate_phase(text, uuid, text, timestamptz)
  from public, authenticated, service_role;
grant execute on function public.publish_qa_candidate_phase(text, uuid, text, timestamptz)
  to anon;
