-- Preparing a current profile does not authorize execution or reset a repair.
create function public.adopt_qa_repair_current_candidate(p_repair_id uuid, p_candidate_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare r public.qa_repair_requests%rowtype; old_c public.qa_candidates%rowtype; c public.qa_candidates%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('intuneget-qa-dispatch',0));
  select * into r from public.qa_repair_requests where id=p_repair_id for update;
  if not found or coalesce(r.status,'') not in ('pending','in_progress')
    or r.failure_class is distinct from 'app_lifecycle' or r.prior_requeues is null or r.prior_requeues >= 3 then
    raise exception 'Repair is not eligible for current profile adoption';
  end if;
  select * into old_c from public.qa_candidates where id=r.candidate_id for update;
  if not found or coalesce(old_c.status,'') not in ('failed','error','superseded')
    or old_c.phase='publishing' or p_candidate_id=old_c.id then
    raise exception 'Original candidate is not available for adoption';
  end if;
  select * into c from public.qa_candidates where id=p_candidate_id for update;
  if not found or c.status is distinct from 'superseded'
    or c.failure_summary is distinct from 'Awaiting diagnostic retest grant'
    or c.finished_at is null or c.test_level is distinct from 'psadt-package'
    or c.test_config->>'profileKind' is distinct from 'catalog-default' then
    raise exception 'Prepared diagnostic candidate is required';
  end if;
  if (lower(c.winget_id),c.version,lower(c.architecture),upper(c.installer_sha256),c.installer_url,c.test_config->>'scope')
    is distinct from (lower(old_c.winget_id),old_c.version,lower(old_c.architecture),upper(old_c.installer_sha256),old_c.installer_url,old_c.test_config->>'scope')
    or (lower(r.winget_id),r.version,lower(r.architecture))
      is distinct from (lower(old_c.winget_id),old_c.version,lower(old_c.architecture))
    or c.installer_sha256 is null or c.installer_sha256 !~ '^[A-Fa-f0-9]{64}$'
    or c.installer_url is null or c.test_config->>'scope' is null then
    raise exception 'Exact original installer tuple and scope are required';
  end if;
  if not exists (select 1 from public.qa_pipeline_control control where control.id='global' and not control.paused
    and control.required_packager_commit=control.scheduler_packager_commit
    and control.scheduler_seen_at >= now()-interval '5 minutes'
    and control.required_packager_commit=((c.test_config->>'packageProfileCanonicalJson')::jsonb)->'toolchain'->>'packagerCommit')
    or upper(encode(extensions.digest(c.test_config->>'packageProfileCanonicalJson','sha256'),'hex')) is distinct from c.package_profile_sha256
    or c.package_profile_sha256 is distinct from c.test_config->>'packageProfileSha256'
    or c.package_profile_sha256 is null then
    raise exception 'Current exact package profile is required';
  end if;
  if not exists (select 1 from public.qa_package_blocks b where lower(b.winget_id)=lower(c.winget_id)
    and b.version=c.version and lower(b.architecture)=lower(c.architecture)
    and upper(b.installer_sha256)=upper(c.installer_sha256) and b.block_code='failed_managed_lifecycle')
    or exists (select 1 from public.qa_repair_requests attached where attached.candidate_id=c.id)
    or exists (select 1 from public.qa_retest_grants g where g.candidate_id=c.id
      or (g.candidate_id=old_c.id and g.closed_at is null)
      or (g.closed_at is null and g.expires_at>now()))
    or exists (select 1 from public.qa_package_results q where q.package_profile_sha256=c.package_profile_sha256)
    or exists (select 1 from public.qa_candidates active where lower(active.winget_id)=lower(c.winget_id)
      and active.version=c.version and lower(active.architecture)=lower(c.architecture)
      and upper(active.installer_sha256)=upper(c.installer_sha256)
      and (active.status in ('queued','dispatched','running') or (active.status='error' and active.phase='publishing'))) then
    raise exception 'Payload or diagnostic candidate is already owned or active';
  end if;
  if exists (select 1 from public.qa_installer_security_holds hold where lower(hold.sha256)=lower(c.installer_sha256) and hold.released_at is null)
    or exists (select 1 from public.catalog_file_reputation reputation where lower(reputation.sha256)=lower(c.installer_sha256)
      and reputation.status='found' and (reputation.malicious>0 or reputation.suspicious>0))
    or exists (select 1 from public.qa_package_results q where upper(q.installer_sha256)=upper(c.installer_sha256)
      and (q.virustotal_malicious>0 or q.virustotal_suspicious>0))
    or exists (select 1 from public.qa_repair_requests security where lower(security.winget_id)=lower(c.winget_id) and security.failure_class='security')
    or exists (select 1 from public.package_eligibility_blocks exclusion where lower(exclusion.winget_id)=lower(c.winget_id))
    or exists (select 1 from public.curated_excluded_apps exclusion where lower(exclusion.winget_id)=lower(c.winget_id))
    or exists (select 1 from public.packaging_jobs customer where customer.status in ('awaiting_qa','queued','packaging')
      and (customer.qa_candidate_id in (old_c.id,c.id) or (lower(customer.winget_id)=lower(c.winget_id)
        and customer.version=c.version and lower(customer.architecture)=lower(c.architecture)
        and upper(customer.installer_sha256)=upper(c.installer_sha256)))) then
    raise exception 'Security, exclusion or customer guard rejected adoption';
  end if;
  update public.qa_repair_requests set candidate_id=c.id where id=r.id and candidate_id=old_c.id;
  if not found then raise exception 'Repair ownership changed'; end if;
  return c.id;
end;
$$;
revoke all on function public.adopt_qa_repair_current_candidate(uuid,uuid) from public,anon,authenticated;
grant execute on function public.adopt_qa_repair_current_candidate(uuid,uuid) to service_role;
