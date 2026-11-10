-- Corrected execution profiles remain inert until a separate guarded retest grant.
create table public.qa_repair_profile_corrections (
  repair_id uuid primary key references public.qa_repair_requests(id),
  old_candidate_id uuid not null references public.qa_candidates(id),
  new_candidate_id uuid not null unique references public.qa_candidates(id),
  old_profile text not null check (old_profile ~ '^[A-F0-9]{64}$'),
  new_profile text not null check (new_profile ~ '^[A-F0-9]{64}$'),
  contract text not null check (contract='exe-embedded-msi-target@1779'),
  created_at timestamptz not null default now(),
  check (old_candidate_id<>new_candidate_id and old_profile<>new_profile)
);
alter table public.qa_repair_profile_corrections enable row level security;
revoke all on public.qa_repair_profile_corrections from public,anon,authenticated;
grant select,insert on public.qa_repair_profile_corrections to service_role;

do $migration$
declare definition text := pg_catalog.pg_get_functiondef('public.adopt_qa_repair_current_candidate(uuid,uuid)'::regprocedure);
  needle text; replacement text;
begin
  if pg_catalog.encode(extensions.digest(definition,'sha256'),'hex') is distinct from '089a5ff8acfb1f2da825d6922303a54c10093bf5daae3a891da5d9660e1644fc' then
    raise exception 'Reviewed diagnostic adoption function changed';
  end if;
  needle := $old0$CREATE OR REPLACE FUNCTION public.adopt_qa_repair_current_candidate(p_repair_id uuid, p_candidate_id uuid)$old0$;
  replacement := $new0$CREATE OR REPLACE FUNCTION public.adopt_qa_repair_corrected_candidate(p_repair_id uuid, p_candidate jsonb, p_expected_old_profile text, p_expected_new_profile text, p_contract text)$new0$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected profile function anchor 0 changed';
  end if;
  definition := replace(definition,needle,replacement);
  needle := $old1$  old_canon jsonb; c_canon jsonb; old_scope text; c_scope text;$old1$;
  replacement := $new1$  old_canon jsonb; c_canon jsonb; old_scope text; c_scope text;
  prior public.qa_repair_profile_corrections%rowtype; prepared jsonb; inserted jsonb;$new1$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected profile function anchor 1 changed';
  end if;
  definition := replace(definition,needle,replacement);
  needle := $old2$  select * into r from public.qa_repair_requests where id=p_repair_id for update;$old2$;
  replacement := $new2$  if p_contract is distinct from 'exe-embedded-msi-target@1779'
    or p_expected_old_profile is null or p_expected_old_profile !~ '^[A-F0-9]{64}$'
    or p_expected_new_profile is null or p_expected_new_profile !~ '^[A-F0-9]{64}$'
    or p_expected_old_profile=p_expected_new_profile
    or jsonb_typeof(p_candidate) is distinct from 'object'
    or p_candidate->'test_config'->>'profileKind' is distinct from 'deployment-config'
    or p_candidate->>'package_profile_sha256' is distinct from p_expected_new_profile then
    raise exception 'Correction contract or profile CAS is invalid';
  end if;
  select * into r from public.qa_repair_requests where id=p_repair_id for update;
  select * into prior from public.qa_repair_profile_corrections where repair_id=p_repair_id;
  if found then
    if (prior.old_profile,prior.new_profile,prior.contract,prior.new_candidate_id)
      is distinct from (p_expected_old_profile,p_expected_new_profile,p_contract,r.candidate_id) then
      raise exception 'Correction lineage already belongs to a different tuple';
    end if;
    return prior.new_candidate_id;
  end if;
  -- Restore FOUND for the inherited repair-existence predicate after the audit lookup.
  perform 1 from public.qa_repair_requests where id=r.id;$new2$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected profile function anchor 2 changed';
  end if;
  definition := replace(definition,needle,replacement);
  needle := $old3$or p_candidate_id=old_c.id$old3$;
  replacement := $new3$or old_c.package_profile_sha256 is distinct from p_expected_old_profile$new3$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected profile function anchor 3 changed';
  end if;
  definition := replace(definition,needle,replacement);
  needle := $old4$  select * into c from public.qa_candidates where id=p_candidate_id for update;$old4$;
  replacement := $new4$  prepared := p_candidate || jsonb_build_object('status','superseded',
    'failure_summary','Awaiting diagnostic retest grant','priority',10,'demand_source','operator',
    'finished_at',now(),'updated_at',now());
  select * into c from jsonb_populate_record(null::public.qa_candidates,prepared);
  c.id := gen_random_uuid();$new4$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected profile function anchor 4 changed';
  end if;
  definition := replace(definition,needle,replacement);
  needle := $old5$      or (c_canon #- '{toolchain,packagerCommit}') is distinct from (old_canon #- '{toolchain,packagerCommit}')$old5$;
  replacement := $new5$      or (c_canon #- '{toolchain,packagerCommit}' #- '{installer,silentArgs}')
        is distinct from (old_canon #- '{toolchain,packagerCommit}' #- '{installer,silentArgs}')
      or c_canon->'installer'->>'sourceType' is distinct from 'exe'
      or old_canon->'installer'->>'sourceType' is distinct from 'exe'
      or coalesce(c_canon->'installer'->>'silentArgs','') !~ '^[ -~]+$'
      or coalesce(c_canon->'installer'->>'silentArgs','') !~ '^(/[^[:space:]]+|--?[^[:space:]]+)'
      or c_canon->'installer'->>'silentArgs' is not distinct from old_canon->'installer'->>'silentArgs'
      or btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        c_canon->'installer'->>'silentArgs',
        '/[ixp]\s+"[^"]+"\s*','','gi'),
        '/[ixp]\s+\{[^}]+\}\s*','','gi'),
        '/[ixp]\s+\S+\.(msi|msp)\s*','','gi'),
        '/[ixp]\s+','','gi')) is distinct from old_canon->'installer'->>'silentArgs'$new5$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected profile function anchor 5 changed';
  end if;
  definition := replace(definition,needle,replacement);
  needle := $old6$  update public.qa_repair_requests set candidate_id=c.id where id=r.id and candidate_id=old_c.id;$old6$;
  replacement := $new6$  -- All inherited guards run before insertion. The primitive is used only
  -- within this locked transaction, never as a caller's admission shortcut.
  if not exists (select 1 from public.catalog_file_reputation reputation
    where reputation.sha256=lower(c.installer_sha256) and reputation.status='found'
      and reputation.malicious=0 and reputation.suspicious=0
      and reputation.engine_count_version=2 and reputation.total_engines between 1 and 9999
      and reputation.checked_at>now()-interval '7 days' and reputation.checked_at<=now()
      and reputation.analyzed_at<=now() and reputation.retry_after>now()) then
    raise exception 'Fresh covered primary reputation is required';
  end if;
  inserted := public.insert_qa_candidate_if_absent(prepared);
  if inserted->>'outcome' is distinct from 'inserted' then
    raise exception 'Corrected profile already exists or the payload became active';
  end if;
  c.id := (inserted->'candidate'->>'id')::uuid;
  if not public.qa_vt_dependency_coverage(c.id) then
    raise exception 'Dependency coverage changed before corrected profile adoption';
  end if;
  update public.qa_repair_requests set candidate_id=c.id where id=r.id and candidate_id=old_c.id;$new6$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected profile function anchor 6 changed';
  end if;
  definition := replace(definition,needle,replacement);
  needle := $old7$  return c.id;$old7$;
  replacement := $new7$  insert into public.qa_repair_profile_corrections(repair_id,old_candidate_id,new_candidate_id,old_profile,new_profile,contract)
    values(r.id,old_c.id,c.id,p_expected_old_profile,p_expected_new_profile,p_contract);
  return c.id;$new7$;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'Corrected profile function anchor 7 changed';
  end if;
  definition := replace(definition,needle,replacement);
  definition := replace(definition,E' LANGUAGE plpgsql\n',E' LANGUAGE plpgsql\n SECURITY INVOKER\n');
  execute definition;
end;
$migration$;
revoke all on function public.adopt_qa_repair_corrected_candidate(uuid,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.adopt_qa_repair_corrected_candidate(uuid,jsonb,text,text,text) to service_role;
