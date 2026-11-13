-- Read-only publication admission. It never grants installer or lifecycle credit.
create function public.check_qa_result_publication_admission(p_secret text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb; reason text; answer jsonb := '[]'; own_count integer := 0;
begin
  perform public.authenticate_qa_installer_recheck(p_secret);
  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_rows) not between 1 and 21
     or pg_catalog.octet_length(p_rows::text) > 65536 then
    raise exception 'Invalid QA publication row bound';
  end if;
  for r in select value from pg_catalog.jsonb_array_elements(p_rows) loop
    if pg_catalog.jsonb_typeof(r) is distinct from 'object'
      or not r ?& array['winget_id','version','architecture','sha256','profile_sha256','run_id','packager_commit','own','carried','outcome','vt_status','malicious','suspicious','engines','engine_version']
      or r - array['winget_id','version','architecture','sha256','profile_sha256','run_id','packager_commit','own','carried','outcome','vt_status','malicious','suspicious','engines','engine_version'] <> '{}'::jsonb
      or pg_catalog.jsonb_typeof(r->'own') is distinct from 'boolean'
      or pg_catalog.jsonb_typeof(r->'carried') is distinct from 'boolean'
      or (r->>'own')::boolean and (r->>'carried')::boolean
      or coalesce(r->>'winget_id','') !~ '^[A-Za-z0-9+._-]{1,250}$'
      or coalesce(r->>'version','') = '' or pg_catalog.length(r->>'version') > 100
      or coalesce(r->>'architecture','') not in ('x86','x64','arm','arm64','neutral')
      or coalesce(r->>'sha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(r->>'profile_sha256','') !~ '^[A-F0-9]{64}$'
      or coalesce(r->>'run_id','') !~ '^[1-9][0-9]{0,19}$'
      or coalesce(r->>'packager_commit','') !~ '^[a-f0-9]{40}$'
      or coalesce(r->>'outcome','') not in ('Passed','Failed') then
      raise exception 'Invalid QA publication row identity';
    end if;
    if (r->>'own')::boolean then own_count := own_count + 1; end if;
  end loop;
  if own_count <> 1 then raise exception 'Invalid QA publication own row'; end if;
  for r in select value from pg_catalog.jsonb_array_elements(p_rows) loop
    reason := 'clear';
    if exists(select 1 from public.qa_installer_security_holds h
        where h.sha256=r->>'sha256' and h.released_at is null) then reason := 'hash_held';
    elsif exists(select 1 from public.package_eligibility_blocks b
        where pg_catalog.lower(b.winget_id)=pg_catalog.lower(r->>'winget_id')) then reason := 'app_blocked';
    elsif exists(select 1 from public.curated_excluded_apps b
        where pg_catalog.lower(b.winget_id)=pg_catalog.lower(r->>'winget_id')) then reason := 'app_excluded';
    elsif exists(select 1 from public.qa_package_blocks b
        where pg_catalog.lower(b.winget_id)=pg_catalog.lower(r->>'winget_id')
          and b.version=r->>'version' and b.architecture=r->>'architecture'
          and pg_catalog.upper(b.installer_sha256)=pg_catalog.upper(r->>'sha256')) then reason := 'tuple_blocked';
    elsif not (r->>'carried')::boolean then
      if not exists(select 1 from public.qa_candidates c
          where c.github_run_id=r->>'run_id' and pg_catalog.lower(c.winget_id)=pg_catalog.lower(r->>'winget_id')
            and c.version=r->>'version' and c.architecture=r->>'architecture'
            and pg_catalog.lower(c.installer_sha256)=r->>'sha256' and c.test_level='psadt-package'
            and pg_catalog.upper(c.package_profile_sha256)=r->>'profile_sha256'
            and pg_catalog.upper(pg_catalog.encode(extensions.digest(pg_catalog.convert_to(c.test_config->>'packageProfileCanonicalJson','UTF8'),'sha256'),'hex'))=r->>'profile_sha256'
            and ((c.test_config->>'packageProfileCanonicalJson')::jsonb #>> '{toolchain,packagerCommit}')=r->>'packager_commit') then
        reason := 'identity_profile_unproved';
      elsif r->>'outcome'='Passed' then
        if r->>'vt_status' is distinct from 'clean'
          or r->'malicious' is distinct from '0'::jsonb or r->'suspicious' is distinct from '0'::jsonb
          or r->'engine_version' is distinct from '2'::jsonb
          or pg_catalog.jsonb_typeof(r->'engines') is distinct from 'number'
          or coalesce(r->>'engines','') !~ '^[1-9][0-9]{0,3}$' then reason := 'record_verdict_unproved';
        elsif not exists(select 1 from public.catalog_file_reputation v
          where v.sha256=r->>'sha256' and v.status='found' and v.malicious=0 and v.suspicious=0
            and v.engine_count_version=2 and v.total_engines between 1 and 9999) then reason := 'cached_verdict_unproved';
        end if;
      end if;
    end if;
    answer := answer || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('row',r,'allowed',reason='clear','reason',reason));
  end loop;
  return pg_catalog.jsonb_build_object('checked_at',pg_catalog.clock_timestamp(),'rows',answer,
    'admitted',not exists(select 1 from pg_catalog.jsonb_array_elements(answer) x where x->>'reason'<>'clear'));
end;
$$;
revoke all on function public.check_qa_result_publication_admission(text,jsonb) from public,authenticated;
grant execute on function public.check_qa_result_publication_admission(text,jsonb) to anon,service_role;
