-- Scope is the two reviewed VC2005 profile corrections from PR1779/PR1781.
-- A passing unblocked corrected profile uses the existing exact-profile admission
-- gate. This migration changes no customer records or admission functions.
do $migration$
declare
  reviewed record; definition text; needle text; replacement text; original_acl aclitem[];
begin
  for reviewed in select * from (values
      ('public.adopt_qa_repair_corrected_candidate(uuid,jsonb,text,text,text)','9f0afc2f7a69e81e926107c3614bead4e1e84250681d8d08961ff1a54722de47'),
      ('public.claim_qa_work(text,uuid,text)','34d5acb6dd2301faf86e83b048aa13ed495dd6df7f2eccde80dfcd700fa379d7'),
      ('public.create_qa_retest_grant(uuid,timestamp with time zone,text)','e375fe291da30eeda654ddd65bbde5be3a11394a2e1469b66d719a11dc7e933c'),
      ('public.qa_retest_grant_eligible(uuid)','eec4dc0986c47c4af282702ca10e52b690297ec55b02dd4d274c6dd8befc6400'),
      ('public.report_qa_candidate_result(text,uuid,text,text)','3dda5c4f2820d93448e66655e39a7ce7e2ce68c3cc1ccd9076632ca018c8768e')) pins(signature,sha256) loop
    if encode(extensions.digest(pg_get_functiondef(reviewed.signature::regprocedure),'sha256'),'hex')
      is distinct from reviewed.sha256 then
      raise exception 'Reviewed corrected-profile sequence changed: %', reviewed.signature;
    end if;
  end loop;

  execute $allowlist$
create function public.qa_corrected_profile_prerequisite_exception(
  p_repair_id uuid,p_old_candidate_id uuid,p_old_profile text,p_new_profile text,p_contract text,
  p_winget_id text,p_version text,p_architecture text,p_installer_sha256 text)
returns boolean language sql immutable security invoker set search_path = '' as $function$
  select coalesce((p_repair_id,p_old_candidate_id,p_old_profile,p_new_profile,p_contract,
    p_winget_id,p_version,lower(p_architecture),upper(p_installer_sha256)) in (values
    ('73f17870-0dcf-4f80-89d0-93f5c1fe913b'::uuid,'69efa220-d8c6-4915-8822-d06d5c74c040'::uuid,'FC3180EC6DC3D3D22FDF4A0D35378067B7476968D6C8D30E2C1701ACE9566CE0','07064E191E446DB7A9DDFC17BB9373CB8E9FFE97CDED2FE4C603FFDD6493F667','exe-embedded-msi-target@1779','Microsoft.VCRedist.2005.x64','8.0.61000','x64','4487570BD86E2E1AAC29DB2A1D0A91EB63361FCAAC570808EB327CD4E0E2240D'),
    ('49abc6df-eb00-40fd-bbd0-98cbbafddb41'::uuid,'e5b0088f-e2bb-4aba-add9-28b61658eb36'::uuid,'86FB9EC34E10D45DB7CEAACE2ECBF462F34F19FA1A3E901A3F476D7A806E83D4','AF7AAF83DD802F9B8B21781F17AFBA8EF1F240BD965BDC78FFAFC7106F27BCC4','exe-embedded-msi-target@1779','Microsoft.VCRedist.2005.x86','8.0.61001','x86','8648C5FC29C44B9112FE52F9A33F80E7FC42D10F3B5B42B2121542A13E44ADFD')),false)
$function$;
$allowlist$;
  revoke all on function public.qa_corrected_profile_prerequisite_exception(uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated,service_role;
  grant execute on function public.qa_corrected_profile_prerequisite_exception(uuid,uuid,text,text,text,text,text,text,text) to service_role;

  definition := pg_get_functiondef('public.adopt_qa_repair_corrected_candidate(uuid,jsonb,text,text,text)'::regprocedure);
  select proacl into original_acl from pg_proc where oid='public.adopt_qa_repair_corrected_candidate(uuid,jsonb,text,text,text)'::regprocedure;
  needle := $needle$not exists (select 1 from public.qa_package_blocks b where lower(b.winget_id)=lower(c.winget_id)
    and b.version=c.version and lower(b.architecture)=lower(c.architecture)
    and upper(b.installer_sha256)=upper(c.installer_sha256) and b.block_code='failed_managed_lifecycle')$needle$;
  replacement := $replacement$not (exists (select 1 from public.qa_package_blocks b where lower(b.winget_id)=lower(c.winget_id)
    and b.version=c.version and lower(b.architecture)=lower(c.architecture)
    and upper(b.installer_sha256)=upper(c.installer_sha256) and b.block_code='failed_managed_lifecycle')
    or (coalesce(public.qa_corrected_profile_prerequisite_exception(r.id,old_c.id,old_c.package_profile_sha256,
      c.package_profile_sha256,p_contract,old_c.winget_id,old_c.version,old_c.architecture,old_c.installer_sha256),false)
      and not exists (select 1 from public.qa_package_blocks other where lower(other.winget_id)=lower(c.winget_id)
      and other.version=c.version and lower(other.architecture)=lower(c.architecture)
      and upper(other.installer_sha256)=upper(c.installer_sha256))))$replacement$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected prerequisite anchor changed: adopt_qa_repair_corrected_candidate 0';
  end if;
  definition := replace(definition,needle,replacement);
  execute definition;
  if exists (select 1 from pg_proc where oid='public.adopt_qa_repair_corrected_candidate(uuid,jsonb,text,text,text)'::regprocedure
    and (prosecdef or proconfig is distinct from ARRAY['search_path=""']::text[]
      or proacl is distinct from original_acl)) then
    raise exception 'Corrected prerequisite function attributes changed: adopt_qa_repair_corrected_candidate';
  end if;

  definition := pg_get_functiondef('public.qa_retest_grant_eligible(uuid)'::regprocedure);
  select proacl into original_acl from pg_proc where oid='public.qa_retest_grant_eligible(uuid)'::regprocedure;
  needle := $needle$    join public.qa_package_blocks b on b.winget_id = c.winget_id and b.version = c.version
      and b.architecture = c.architecture and b.installer_sha256 = c.installer_sha256
$needle$;
  replacement := $replacement$$replacement$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected prerequisite anchor changed: qa_retest_grant_eligible 0';
  end if;
  definition := replace(definition,needle,replacement);
  needle := $needle$and b.block_code = 'failed_managed_lifecycle'$needle$;
  replacement := $replacement$and (exists (select 1 from public.qa_package_blocks b where b.winget_id=c.winget_id
        and b.version=c.version and b.architecture=c.architecture and b.installer_sha256=c.installer_sha256
        and b.block_code='failed_managed_lifecycle')
      or (not exists (select 1 from public.qa_package_blocks other where lower(other.winget_id)=lower(c.winget_id)
      and other.version=c.version and lower(other.architecture)=lower(c.architecture)
      and upper(other.installer_sha256)=upper(c.installer_sha256))
        and exists (select 1 from public.qa_repair_profile_corrections lineage
          join public.qa_candidates o on o.id=lineage.old_candidate_id
          where lineage.repair_id=r.id and lineage.new_candidate_id=c.id
            and lineage.old_profile=o.package_profile_sha256 and lineage.new_profile=c.package_profile_sha256
            and not exists (select 1 from public.packaging_jobs old_job
              where old_job.qa_candidate_id=o.id and old_job.status in ('awaiting_qa','queued','packaging'))
            and (lower(o.winget_id),o.version,lower(o.architecture),upper(o.installer_sha256))
              = (lower(c.winget_id),c.version,lower(c.architecture),upper(c.installer_sha256))
            and coalesce(public.qa_corrected_profile_prerequisite_exception(lineage.repair_id,o.id,
              lineage.old_profile,lineage.new_profile,lineage.contract,o.winget_id,o.version,o.architecture,o.installer_sha256),false)
            and c.test_config->>'profileKind'='deployment-config'
            and c.test_config->>'packageProfileSha256'=c.package_profile_sha256
            and upper(encode(extensions.digest(c.test_config->>'packageProfileCanonicalJson','sha256'),'hex'))=c.package_profile_sha256
            and upper(encode(extensions.digest(o.test_config->>'packageProfileCanonicalJson','sha256'),'hex'))=o.package_profile_sha256
            and c.test_config->'psadtConfig' is not distinct from o.test_config->'psadtConfig'
            and c.test_config->'detectionRules' is not distinct from o.test_config->'detectionRules')))$replacement$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected prerequisite anchor changed: qa_retest_grant_eligible 1';
  end if;
  definition := replace(definition,needle,replacement);
  execute definition;
  if exists (select 1 from pg_proc where oid='public.qa_retest_grant_eligible(uuid)'::regprocedure
    and (prosecdef or proconfig is distinct from ARRAY['search_path=""']::text[]
      or proacl is distinct from original_acl or provolatile<>'s')) then
    raise exception 'Corrected prerequisite function attributes changed: qa_retest_grant_eligible';
  end if;

  definition := pg_get_functiondef('public.claim_qa_work(text,uuid,text)'::regprocedure);
  select proacl into original_acl from pg_proc where oid='public.claim_qa_work(text,uuid,text)'::regprocedure;
  needle := $needle$or exists (select 1 from public.qa_retest_grants where candidate_id=p_id))$needle$;
  replacement := $replacement$or exists (select 1 from public.qa_retest_grants where candidate_id=p_id)
      or exists (select 1 from public.qa_repair_profile_corrections lineage where lineage.new_candidate_id=p_id))$replacement$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected prerequisite anchor changed: claim_qa_work 0';
  end if;
  definition := replace(definition,needle,replacement);
  execute definition;
  if exists (select 1 from pg_proc where oid='public.claim_qa_work(text,uuid,text)'::regprocedure
    and (prosecdef or proconfig is distinct from ARRAY['search_path=""']::text[]
      or proacl is distinct from original_acl)) then
    raise exception 'Corrected prerequisite function attributes changed: claim_qa_work';
  end if;
end;
$migration$;
