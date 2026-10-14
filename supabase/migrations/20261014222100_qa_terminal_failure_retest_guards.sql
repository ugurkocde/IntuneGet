-- Settled failures may prepare another guarded diagnostic; pending publications stay held.
-- Replace only the reviewed predicate. No candidate, repair, grant or quarantine row changes.
do $migration$
declare signature text; expected_hash text; candidate_alias text; needle text;
  definition text; replacement text; fn regprocedure;
begin
  for signature, expected_hash, candidate_alias, needle in
    select * from (values
      ('public.create_qa_retest_grant(uuid,timestamp with time zone,text)', 'ad3fe66691336389a3f5ae92a33c9541bba4b9062068b428064f5764af7a00f6', 'c', 'or c.phase = ''publishing'''),
      ('public.adopt_qa_repair_current_candidate(uuid,uuid)', 'fc70d9f18d008cfd6d2c83467acbb3162c1afc1fbee8a30b3d5beadf78d48014', 'old_c', 'or old_c.phase=''publishing''')
    ) as targets(signature, expected_hash, candidate_alias, needle)
  loop
    fn := pg_catalog.to_regprocedure(signature);
    if fn is null then raise exception 'Required diagnostic repair function missing: %', signature; end if;
    definition := pg_catalog.pg_get_functiondef(fn);
    if pg_catalog.encode(extensions.digest(definition,'sha256'),'hex') is distinct from expected_hash
      or (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 then
      raise exception 'Reviewed diagnostic repair function changed: %', signature;
    end if;
    replacement := replace($predicate$or (__candidate__.phase = 'publishing' and not (
      __candidate__.status = 'failed' and __candidate__.finished_at is not null
      and exists (
        select 1 from public.qa_package_results settled
        where settled.outcome = 'Failed'
          and settled.winget_id = __candidate__.winget_id
          and settled.tested_version = __candidate__.version
          and lower(settled.architecture) = lower(__candidate__.architecture)
          and settled.package_profile_sha256 = __candidate__.package_profile_sha256
          and upper(settled.installer_sha256) = upper(__candidate__.installer_sha256)
      )
    ))$predicate$, '__candidate__', candidate_alias);
    execute replace(definition,needle,replacement);
  end loop;
end;
$migration$;
