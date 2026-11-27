SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
-- Serialize definition inspection and replacement with concurrent function DDL.
ALTER FUNCTION public.refresh_catalog_release_history_cache() COST 100;

-- Preserve the refresh implementation and its security attributes. Only the
-- cache bounds delete changes: safeupdate requires an explicit predicate.
DO $guard$
DECLARE target regprocedure := 'public.refresh_catalog_release_history_cache()'::regprocedure;
 predecessor record; replacement record; definition text; expected_body text;
BEGIN
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict,prosrc,md5(prosrc) AS body
 INTO predecessor FROM pg_proc WHERE oid=target;
 IF predecessor.body NOT IN ('31d18d43c3f04ddf2f3ce7b843b01a12','9a4e815038f95848b07b4d8c39eaaec2')
  OR predecessor.proowner<>current_user::regrole::oid
  OR predecessor.prosecdef OR predecessor.provolatile<>'v' OR predecessor.proisstrict
  OR predecessor.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  OR predecessor.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 THEN RAISE EXCEPTION 'Unexpected catalog history refresh predecessor'; END IF;
 definition := pg_get_functiondef(target);
 -- The primary key is NOT NULL; include every existing key, even an obsolete
 -- out-of-range page, without changing locks or disabling the server guard.
 definition := replace(definition,
  'DELETE FROM catalog_internal.catalog_release_history_page_bounds;',
  'DELETE FROM catalog_internal.catalog_release_history_page_bounds WHERE page_number IS NOT NULL;');
 expected_body := md5(replace(predecessor.prosrc,
  'DELETE FROM catalog_internal.catalog_release_history_page_bounds;',
  'DELETE FROM catalog_internal.catalog_release_history_page_bounds WHERE page_number IS NOT NULL;'));
 EXECUTE definition;
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict,md5(prosrc) AS body
 INTO replacement FROM pg_proc WHERE oid=target;
 IF replacement.body<>expected_body OR
  (replacement.proowner,replacement.proacl,replacement.proconfig,replacement.prosecdef,
   replacement.provolatile,replacement.prolang,replacement.proisstrict) IS DISTINCT FROM
  (predecessor.proowner,predecessor.proacl,predecessor.proconfig,predecessor.prosecdef,
   predecessor.provolatile,predecessor.prolang,predecessor.proisstrict)
 THEN RAISE EXCEPTION 'Catalog history refresh replacement changed security attributes'; END IF;
END;
$guard$;
