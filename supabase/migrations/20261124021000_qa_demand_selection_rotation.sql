-- Rotate eligible demand keys using the existing caller selection ledger.
-- Caller behavior, filters, priority ties, bounds and overlap protocol are unchanged.
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $migration$
DECLARE
  selector text;
  expected_timeout text;
  before_state record;
  after_state record;
  definition text;
  join_anchor constant text := E'  left join current_version_failures as failure\n    on failure.winget_id = app.winget_id\n';
  order_anchor constant text := E'  order by\n    failure.last_failed_at desc nulls last,';
BEGIN
  FOREACH selector IN ARRAY ARRAY['qa_missing_demand_backfill_ids','qa_cron_demand_backfill_ids'] LOOP
    expected_timeout := CASE selector WHEN 'qa_missing_demand_backfill_ids' THEN '2s' ELSE '8s' END;
    SELECT p.oid,md5(p.prosrc) body,p.proconfig,p.proacl,p.proowner,p.prosecdef,p.provolatile,l.lanname
      INTO before_state
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=pg_catalog.to_regprocedure('public.'||selector||'(integer)');
    IF NOT FOUND OR before_state.body<>'e13e0a07df117bd78f37ee037e497253'
      OR before_state.proconfig IS DISTINCT FROM ARRAY['search_path=""','statement_timeout='||expected_timeout]::text[]
      OR before_state.prosecdef IS DISTINCT FROM true OR before_state.provolatile<>'v'
      OR before_state.lanname<>'plpgsql'
      OR before_state.proowner<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) THEN
      RAISE EXCEPTION 'Unexpected demand selector source, owner or configuration: %',selector;
    END IF;
    definition:=pg_catalog.pg_get_functiondef(before_state.oid);
    IF length(definition)-length(replace(definition,join_anchor,''))<>length(join_anchor)
      OR length(definition)-length(replace(definition,order_anchor,''))<>length(order_anchor) THEN
      RAISE EXCEPTION 'Unexpected demand selector anchors: %',selector;
    END IF;
    definition:=replace(definition,join_anchor,join_anchor||E'  left join public.qa_demand_backfill_selections as selection\n    on selection.winget_id = app.winget_id\n');
    definition:=replace(definition,order_anchor,E'  order by\n    selection.last_selected_at asc nulls first,\n    failure.last_failed_at desc nulls last,');
    EXECUTE definition;
    SELECT proconfig,proacl,proowner,prosecdef,provolatile,prolang INTO after_state
      FROM pg_catalog.pg_proc WHERE oid=before_state.oid;
    IF after_state.proconfig IS DISTINCT FROM before_state.proconfig
      OR after_state.proacl IS DISTINCT FROM before_state.proacl
      OR after_state.proowner IS DISTINCT FROM before_state.proowner
      OR after_state.prosecdef IS DISTINCT FROM before_state.prosecdef
      OR after_state.provolatile IS DISTINCT FROM before_state.provolatile
      OR after_state.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname=before_state.lanname) THEN
      RAISE EXCEPTION 'Demand selector metadata changed: %',selector;
    END IF;
  END LOOP;
END;
$migration$;
