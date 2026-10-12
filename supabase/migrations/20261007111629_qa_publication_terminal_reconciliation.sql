-- Completed publication must not occupy the single-active-VM slot, or collide
-- with a queued candidate for the same payload. Preserve the established
-- reporter's authentication, promotion, security and repair behavior.
do $migration$
declare
  reporter text := pg_get_functiondef('public.report_qa_candidate_result(text,uuid,text,text)'::regprocedure);
  recovery text := pg_get_functiondef('public.reconcile_qa_result_publication(text)'::regprocedure);
  old_where constant text := $old$where id = p_candidate_id and status in ('dispatched', 'running')$old$;
  new_where constant text := $new$where id = p_candidate_id
    and (
      status in ('dispatched', 'running')
      or (
        -- Publication recovery may settle an authenticated exact-run terminal result.
        status = 'error' and phase = 'publishing'
        and normalized_outcome in ('passed', 'failed')
        and exists (
          select 1 from public.qa_package_results as published
          where published.package_profile_sha256 = qa_candidates.package_profile_sha256
            and published.winget_id = qa_candidates.winget_id
            and published.tested_version = qa_candidates.version
            and published.architecture = qa_candidates.architecture
            and published.installer_sha256 = qa_candidates.installer_sha256
            and published.github_run_url = qa_candidates.github_run_url
            and published.tested_at_utc >= qa_candidates.started_at
            and lower(published.outcome) = normalized_outcome
            and (published.outcome = 'Failed' or coalesce(published.virustotal_malicious, 0) = 0)
        )
      )
    )$new$;
  old_transition constant text := $old$update public.qa_candidates set status = 'running' where id = pending.id;$old$;
begin
  -- Fail closed if the deployed function changed instead of silently editing
  -- an unrecognized reporter. CREATE OR REPLACE retains existing grants.
  if (length(reporter) - length(replace(reporter, old_where, ''))) <> length(old_where) then
    raise exception 'Unrecognized QA result reporter predicate';
  end if;
  if (length(recovery) - length(replace(recovery, old_transition, ''))) <> length(old_transition) then
    raise exception 'Unrecognized QA publication recovery transition';
  end if;
  execute replace(reporter, old_where, new_where);
  execute replace(recovery, old_transition,
    '-- Settle terminal evidence without taking the active execution slot.');
end;
$migration$;
