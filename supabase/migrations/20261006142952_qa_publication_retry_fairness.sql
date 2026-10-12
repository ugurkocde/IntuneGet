-- Record sanitized row failures and rotate retries behind fresh evidence.
-- Preserve the exact-run evidence and secret-authentication boundaries.
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
    order by
      (coalesce(candidate.failure_summary, '') like 'Publication reconciliation deferred (SQLSTATE %).'),
      candidate.updated_at nulls first, candidate.started_at, candidate.id
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
    exception
      when insufficient_privilege then raise;
      when others then
        -- Roll back this candidate only, including downstream constraint or
        -- promotion errors. Authentication failures still abort the call.
        -- SQLERRM can contain private row values; record only its SQLSTATE.
        raise warning 'QA publication reconciliation deferred candidate % (SQLSTATE %)', pending.id, SQLSTATE;
        update public.qa_candidates
          set failure_summary = 'Publication reconciliation deferred (SQLSTATE ' || SQLSTATE || ').',
              updated_at = now()
          where id = pending.id;
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
