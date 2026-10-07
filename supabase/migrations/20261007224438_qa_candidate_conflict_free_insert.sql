-- Both the exact-profile and normalized active-payload indexes arbitrate
-- enqueue races. Catch only those expected conflicts before they reach API logs.
-- This function never updates an existing candidate or resets its lifecycle.
create or replace function public.insert_qa_candidate_if_absent(p_candidate jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate public.qa_candidates;
  inserted public.qa_candidates;
  conflict_name text;
  retry integer;
begin
  if jsonb_typeof(p_candidate) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_candidate) key
    where key not in ('winget_id','definition_path','version','architecture',
      'installer_url','installer_sha256','installer_type','installer_file_name',
      'test_level','package_profile_sha256','test_config','catalog_version_at_enqueue',
      'status','priority','demand_source','failure_summary','finished_at','updated_at')
  ) then
    raise exception 'Unsupported QA candidate fields' using errcode = '22023';
  end if;
  candidate := jsonb_populate_record(null::public.qa_candidates, p_candidate);
  if candidate.test_level is distinct from 'psadt-package'
    or candidate.status is null
    or candidate.status not in ('queued', 'passed', 'superseded')
    or (candidate.status = 'queued' and (candidate.finished_at is not null or candidate.failure_summary is not null))
    or (candidate.status in ('passed','superseded') and candidate.finished_at is null)
    or (candidate.status = 'superseded' and candidate.failure_summary is null) then
    raise exception 'Unsupported QA candidate insertion state' using errcode = '22023';
  end if;

  for retry in 1..3 loop
    begin
      insert into public.qa_candidates (
        winget_id, definition_path, version, architecture, installer_url,
        installer_sha256, installer_type, installer_file_name, test_level,
        package_profile_sha256, test_config, catalog_version_at_enqueue,
        status, priority, demand_source, failure_summary, finished_at, updated_at
      ) values (
        candidate.winget_id, candidate.definition_path, candidate.version,
        candidate.architecture, candidate.installer_url, candidate.installer_sha256,
        candidate.installer_type, candidate.installer_file_name, candidate.test_level,
        candidate.package_profile_sha256, coalesce(candidate.test_config, '{}'::jsonb),
        candidate.catalog_version_at_enqueue, candidate.status,
        coalesce(candidate.priority, 0), coalesce(candidate.demand_source, 'catalog'),
        candidate.failure_summary, candidate.finished_at, coalesce(candidate.updated_at, now())
      ) returning * into inserted;
      return jsonb_build_object('outcome','inserted','candidate',to_jsonb(inserted));
    exception when unique_violation then
      get stacked diagnostics conflict_name = constraint_name;
      if conflict_name not in ('qa_candidates_exact_package_key','qa_candidates_one_active_payload_idx') then
        raise;
      end if;
    end;

    if conflict_name = 'qa_candidates_exact_package_key' then
      select q.* into inserted from public.qa_candidates q
      where q.winget_id = candidate.winget_id and q.version = candidate.version
        and q.architecture = candidate.architecture and q.installer_sha256 = candidate.installer_sha256
        and q.package_profile_sha256 = candidate.package_profile_sha256;
      if found then
        return jsonb_build_object('outcome','exact_conflict','candidate',to_jsonb(inserted));
      end if;
    else
      select q.* into inserted from public.qa_candidates q
      where lower(q.winget_id) = lower(candidate.winget_id) and q.version = candidate.version
        and lower(q.architecture) = lower(candidate.architecture)
        and upper(q.installer_sha256) = upper(candidate.installer_sha256)
        and q.test_level = 'psadt-package' and q.status in ('queued','dispatched','running');
      if found then
        return jsonb_build_object('outcome','active_conflict','candidate',to_jsonb(inserted));
      end if;
    end if;
    -- A concurrent lifecycle transition can remove the active conflict.
    -- Retry within a fixed budget instead of fabricating a known candidate.
  end loop;
  raise exception 'QA candidate conflict changed during enqueue; retry later' using errcode = '40001';
end;
$$;

revoke all on function public.insert_qa_candidate_if_absent(jsonb) from public, anon, authenticated;
grant execute on function public.insert_qa_candidate_if_absent(jsonb) to service_role;
