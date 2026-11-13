-- Coordinated capacity: one default result and twenty-one deployment profiles.
DO $capacity$
DECLARE
  target oid := 'public.check_qa_result_publication_admission(text,jsonb)'::regprocedure;
  before_row pg_catalog.pg_proc%rowtype;
  after_row pg_catalog.pg_proc%rowtype;
  before_definition text;
  expected_definition text;
  old_bound constant text := 'pg_catalog.jsonb_array_length(p_rows) not between 1 and 21';
BEGIN
  SELECT * INTO STRICT before_row FROM pg_catalog.pg_proc WHERE oid=target;
  before_definition := pg_catalog.pg_get_functiondef(target);
  IF pg_catalog.encode(extensions.digest(before_definition,'sha256'),'hex') <> '3cead78d722323655ace7a1d803977285bc93cc38322c03e81246656e293aa51'
     OR pg_catalog.array_length(pg_catalog.string_to_array(before_definition,old_bound),1) <> 2 THEN
    RAISE EXCEPTION 'Publication admission source drift';
  END IF;
  expected_definition := pg_catalog.replace(before_definition,old_bound,'pg_catalog.jsonb_array_length(p_rows) not between 1 and 22');
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
END $capacity$;
