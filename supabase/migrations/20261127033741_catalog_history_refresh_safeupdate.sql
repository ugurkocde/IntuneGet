SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';

-- Preserve the refresh implementation and its security attributes. Only the
-- cache bounds delete changes: safeupdate requires an explicit predicate.
DO $guard$
DECLARE target regprocedure := 'public.refresh_catalog_release_history_cache()'::regprocedure;
 predecessor record; definition text;
BEGIN
 SELECT proowner,proconfig,prosecdef,provolatile,proisstrict,md5(prosrc) AS body
 INTO predecessor FROM pg_proc WHERE oid=target;
 IF predecessor.body<>'31d18d43c3f04ddf2f3ce7b843b01a12'
  OR predecessor.proowner<>current_user::regrole::oid
  OR predecessor.prosecdef OR predecessor.provolatile<>'v' OR predecessor.proisstrict
  OR predecessor.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 THEN RAISE EXCEPTION 'Unexpected catalog history refresh predecessor'; END IF;
 definition := pg_get_functiondef(target);
 -- The primary key is NOT NULL; include every existing key, even an obsolete
 -- out-of-range page, without changing locks or disabling the server guard.
 definition := replace(definition,
  'DELETE FROM catalog_internal.catalog_release_history_page_bounds;',
  'DELETE FROM catalog_internal.catalog_release_history_page_bounds WHERE page_number IS NOT NULL;');
 EXECUTE definition;
END;
$guard$;
