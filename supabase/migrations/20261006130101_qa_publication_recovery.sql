-- Preserve completed VM work while its protected result PR is published.
-- Only canonical exact-profile evidence can resolve a publication failure.
create or replace function public.reconcile_qa_result_publication(p_secret text)
returns integer language plpgsql security definer
set search_path = public, extensions, pg_temp
set statement_timeout = '30s'
as $$
declare
  expected_secret_hash constant text := 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921';
  pending record;
  reconciled integer := 0;
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;
  for pending in
    select candidate.id, result.outcome, result.virustotal_malicious
    from public.qa_candidates candidate
    join public.qa_package_results result
      on result.package_profile_sha256 = candidate.package_profile_sha256
      and result.winget_id = candidate.winget_id
      and result.tested_version = candidate.version
      and result.architecture = candidate.architecture
      and result.installer_sha256 = candidate.installer_sha256
      and result.github_run_url = candidate.github_run_url
      and result.tested_at_utc >= candidate.started_at
    where candidate.status = 'error' and candidate.phase = 'publishing'
      and result.outcome in ('Passed', 'Failed')
      and (result.outcome = 'Failed' or coalesce(result.virustotal_malicious, 0) = 0)
    order by candidate.started_at
    limit 100
    for update of candidate skip locked
  loop
    -- Reuse the established result reporter, including catalog-promotion and
    -- failed-installer security/repair policy, within this locked transaction.
    begin
      update public.qa_candidates set status = 'running' where id = pending.id;
      if not public.report_qa_candidate_result(
        p_secret, pending.id, lower(pending.outcome),
        case when pending.virustotal_malicious >= 1 then 'VirusTotal blocked the published exact installer.'
          when pending.outcome = 'Failed' then 'The published exact package did not pass QA.' else null end
      ) then
        raise exception 'Publication result reconciliation was rejected';
      end if;
      reconciled := reconciled + 1;
    exception when raise_exception then
      -- Roll back this candidate only. A catalog promotion waiting for its
      -- canonical mirror must not prevent independent results from settling.
      continue;
    end;
  end loop;
  return reconciled;
end;
$$;
revoke all on function public.reconcile_qa_result_publication(text) from public, authenticated, service_role;
grant execute on function public.reconcile_qa_result_publication(text) to anon;
comment on function public.reconcile_qa_result_publication(text) is
  'Secret-authenticated recovery from canonical published exact-run evidence; never starts VM work.';

-- Allow the protected GitHub operator workflow to re-queue a terminal QA
-- infrastructure failure without exposing a broad database credential.
create or replace function public.recover_qa_candidate(
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
  changed integer;
begin
  if encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') <> expected_secret_hash then
    raise insufficient_privilege using message = 'Invalid QA synchronization credential';
  end if;

  update public.qa_candidates
  set status = 'queued',
      attempts = 0,
      dispatched_at = null,
      started_at = null,
      finished_at = null,
      github_run_id = null,
      github_run_url = null,
      phase = null,
      phase_started_at = null,
      phase_updated_at = null,
      live_activity = null,
      activity_updated_at = null,
      live_log = null,
      log_updated_at = null,
      failure_summary = null,
      updated_at = now()
  where id = p_candidate_id
    and test_level = 'psadt-package'
    and status in ('error', 'superseded')
    and phase is distinct from 'publishing';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.recover_qa_candidate(text, uuid)
  from public, authenticated, service_role;
grant execute on function public.recover_qa_candidate(text, uuid) to anon;
