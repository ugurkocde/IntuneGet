SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
-- Serialize definition inspection and replacement with concurrent function DDL.
ALTER FUNCTION public.refresh_catalog_release_history_cache() COST 100;

-- Replace the array_agg/unnest/width_bucket refresh implementation with a
-- single-statement set-based scan that computes global metadata and up to
-- 10,000 page bounds without copying full history timestamp arrays per page.
DO $guard$
DECLARE target regprocedure := 'public.refresh_catalog_release_history_cache()'::regprocedure;
 predecessor record; replacement record;
BEGIN
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict,md5(prosrc) AS body
 INTO predecessor FROM pg_proc WHERE oid=target;
 IF predecessor.body NOT IN ('9b5c864e717868b98eb6e47385efff0d','93e8474bdd368e68d98e714c0a287330')
  OR predecessor.proowner<>current_user::regrole::oid
  OR predecessor.prosecdef OR predecessor.provolatile<>'v' OR predecessor.proisstrict
  OR predecessor.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  OR predecessor.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 THEN RAISE EXCEPTION 'Unexpected catalog history refresh predecessor'; END IF;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION public.refresh_catalog_release_history_cache() RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE
 v_total integer;
 v_apps bigint;
 v_months jsonb;
 v_coverage_start timestamptz;
 snap pg_snapshot;
 vh_path text;
 ca_path text;
 b_pages integer[];
 b_hi timestamptz[];
 b_lo timestamptz[];
 b_tie_skip integer[];
BEGIN
 IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'refresh_catalog_release_history_cache requires read committed isolation';
 END IF;
 -- An older assigned XID can appear visible in a later build snapshot even
 -- though this same transaction may still write after the cache is built.
 IF pg_catalog.pg_current_xact_id_if_assigned() IS NOT NULL THEN
  RAISE EXCEPTION 'Catalog history cache refresh requires an unassigned transaction';
 END IF;
 IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('catalog_release_history_cache',0)) THEN RETURN false; END IF;
 LOCK TABLE public.version_history,public.curated_apps IN ACCESS SHARE MODE;
 IF NOT catalog_internal.invoker_has_unrestricted_history_visibility() THEN
  RAISE EXCEPTION 'Catalog history cache requires unrestricted source visibility';
 END IF;
 IF catalog_internal.history_cache_is_usable() THEN RETURN false; END IF;
 -- A single statement pins the source data, physical identity and build snapshot
 -- without materializing full history timestamp arrays or per-page bucket scans.
 WITH base AS MATERIALIZED (
  SELECT v.created_at,c.id AS app_id
  FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
  WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
 ), by_ts AS MATERIALIZED (
  SELECT created_at,count(*)::bigint AS cnt,
   sum(count(*)) OVER (ORDER BY created_at DESC)::bigint AS end_pos
  FROM base GROUP BY created_at
 ), spans AS (
  SELECT created_at,end_pos-cnt+1 AS start_pos,end_pos FROM by_ts
 ), totals AS MATERIALIZED (
  SELECT coalesce(max(end_pos),0)::bigint AS total_rows,min(created_at) AS coverage_start FROM by_ts
 ), hi_pages AS (
  SELECT p::integer AS page_number,s.created_at AS hi,
   (((p-1)*40+1)-s.start_pos)::integer AS tie_skip
  FROM spans s
  CROSS JOIN LATERAL pg_catalog.generate_series(
   ((s.start_pos+38)/40)+1,
   least(((s.end_pos-1)/40)+1,10000::bigint)
  ) p
 ), lo_pages AS (
  SELECT p::integer AS page_number,s.created_at AS lo
  FROM spans s CROSS JOIN totals t
  CROSS JOIN LATERAL pg_catalog.generate_series(
   (s.start_pos+39)/40,
   least(CASE WHEN s.end_pos=t.total_rows THEN (t.total_rows+39)/40 ELSE s.end_pos/40 END,10000::bigint)
  ) p
  WHERE t.total_rows>0
 ), bounds_agg AS (
  SELECT array_agg(h.page_number ORDER BY h.page_number) AS pages,
   array_agg(h.hi ORDER BY h.page_number) AS his,
   array_agg(l.lo ORDER BY h.page_number) AS los,
   array_agg(h.tie_skip ORDER BY h.page_number) AS skips
  FROM hi_pages h JOIN lo_pages l ON l.page_number=h.page_number
 ), app_stats AS (
  SELECT count(DISTINCT app_id)::bigint AS apps FROM base
 ), month_stats AS (
  SELECT coalesce(jsonb_agg(m ORDER BY m DESC),'[]'::jsonb) AS months
  FROM (SELECT pg_catalog.to_char(created_at AT TIME ZONE 'UTC','YYYY-MM') AS m FROM by_ts GROUP BY 1) q
 )
 SELECT t.total_rows::integer,a.apps,m.months,t.coverage_start,
  pg_catalog.pg_current_snapshot(),
  pg_catalog.pg_relation_filepath('public.version_history'::regclass),
  pg_catalog.pg_relation_filepath('public.curated_apps'::regclass),
  coalesce(b.pages,'{}'::integer[]),
  coalesce(b.his,'{}'::timestamptz[]),
  coalesce(b.los,'{}'::timestamptz[]),
  coalesce(b.skips,'{}'::integer[])
 INTO v_total,v_apps,v_months,v_coverage_start,snap,vh_path,ca_path,b_pages,b_hi,b_lo,b_tie_skip
 FROM totals t CROSS JOIN app_stats a CROSS JOIN month_stats m CROSS JOIN bounds_agg b;
 INSERT INTO catalog_internal.catalog_release_history_meta
 VALUES (1,snap,v_total,v_apps,v_months,v_coverage_start,vh_path,ca_path)
 ON CONFLICT(id) DO UPDATE SET built_snap=excluded.built_snap,total=excluded.total,
  apps=excluded.apps,months=excluded.months,coverage_start=excluded.coverage_start,
  version_history_filepath=excluded.version_history_filepath,curated_apps_filepath=excluded.curated_apps_filepath;
 DELETE FROM catalog_internal.catalog_release_history_page_bounds WHERE page_number IS NOT NULL;
 INSERT INTO catalog_internal.catalog_release_history_page_bounds(page_number,hi,lo,tie_skip)
 SELECT p,hi,lo,tie_skip FROM ROWS FROM (
  pg_catalog.unnest(b_pages),
  pg_catalog.unnest(b_hi),
  pg_catalog.unnest(b_lo),
  pg_catalog.unnest(b_tie_skip)
 ) AS u(p,hi,lo,tie_skip);
 DELETE FROM catalog_internal.catalog_release_history_invalidation i WHERE pg_catalog.pg_visible_in_snapshot(i.xid,snap);
 RETURN true;
END;
$$;$definition$;
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict
 INTO replacement FROM pg_proc WHERE oid=target;
 IF (replacement.proowner,replacement.proacl,replacement.proconfig,replacement.prosecdef,
  replacement.provolatile,replacement.prolang,replacement.proisstrict) IS DISTINCT FROM
  (predecessor.proowner,predecessor.proacl,predecessor.proconfig,predecessor.prosecdef,
   predecessor.provolatile,predecessor.prolang,predecessor.proisstrict)
 THEN RAISE EXCEPTION 'Catalog history refresh replacement changed security attributes'; END IF;
END;
$guard$;
