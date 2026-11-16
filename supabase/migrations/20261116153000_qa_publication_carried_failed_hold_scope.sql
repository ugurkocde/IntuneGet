-- A security hold must never hold a newer version. A carried row is already
-- on main byte for byte, and a carried Failed row grants no deployment credit,
-- so its held hash no longer denies publication of a newer result. Held own
-- rows, held changed rows and held carried Passed rows are still denied, and
-- app, exclusion and tuple blocks are unchanged.
DO $carried$
DECLARE
  target oid := 'public.check_qa_result_publication_admission(text,jsonb)'::regprocedure;
  before_row pg_catalog.pg_proc%rowtype;
  after_row pg_catalog.pg_proc%rowtype;
  before_definition text;
  expected_definition text;
  old_hold constant text := 'h.released_at is null) then reason := ''hash_held'';';
  new_hold constant text := 'h.released_at is null)
        and not ((r->>''carried'')::boolean and r->>''outcome''=''Failed'') then reason := ''hash_held'';';
BEGIN
  SELECT * INTO STRICT before_row FROM pg_catalog.pg_proc WHERE oid=target;
  before_definition := pg_catalog.pg_get_functiondef(target);
  IF pg_catalog.encode(extensions.digest(before_definition,'sha256'),'hex') <> 'a477aef0018869863475243cf1a334bd7196568e50fba404ca257a7cc3cbda5f'
     OR pg_catalog.array_length(pg_catalog.string_to_array(before_definition,old_hold),1) <> 2 THEN
    RAISE EXCEPTION 'Publication admission source drift';
  END IF;
  expected_definition := pg_catalog.replace(before_definition,old_hold,new_hold);
  EXECUTE expected_definition;
  SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=target;
  IF after_row.proowner IS DISTINCT FROM before_row.proowner
     OR after_row.proacl IS DISTINCT FROM before_row.proacl
     OR after_row.prosecdef IS DISTINCT FROM before_row.prosecdef
     OR after_row.proconfig IS DISTINCT FROM before_row.proconfig
     OR after_row.provolatile IS DISTINCT FROM before_row.provolatile
     OR pg_catalog.pg_get_functiondef(target) IS DISTINCT FROM expected_definition THEN
    RAISE EXCEPTION 'Publication admission properties changed';
  END IF;
END $carried$;
