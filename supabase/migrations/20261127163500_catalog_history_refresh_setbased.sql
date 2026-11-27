SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
-- Serialize definition inspection and replacement with concurrent function DDL.
ALTER FUNCTION public.refresh_catalog_release_history_cache() COST 100;

-- Replace the per-page full-array scan and full-history to_char formatting in
-- refresh_catalog_release_history_cache with a single-statement ordered
-- timestamp snapshot plus O(pages) page-boundary extraction and binary search
-- only on tied page starts.
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
 ts timestamptz[];
 v_total integer;
 v_apps bigint;
 v_months jsonb;
 v_coverage_start timestamptz;
 snap pg_snapshot;
 vh_path text;
 ca_path text;
 n_pages integer;
 p integer;
 pos integer;
 lo_pos integer;
 hi_ts timestamptz;
 lo_ts timestamptz;
 l integer;
 r integer;
 mid integer;
 hi_m text;
 lo_m text;
 prev_m text;
 cur_m text;
 k integer;
 b_pages integer[];
 b_hi timestamptz[];
 b_lo timestamptz[];
 b_tie_skip integer[];
 m_list text[] := '{}'::text[];
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
 -- A single statement pins the source data, physical identity and build snapshot.
 SELECT pg_catalog.array_agg(v.created_at ORDER BY v.created_at DESC),
  count(DISTINCT c.id)::bigint,
  pg_catalog.pg_current_snapshot(),
  pg_catalog.pg_relation_filepath('public.version_history'::regclass),
  pg_catalog.pg_relation_filepath('public.curated_apps'::regclass)
 INTO ts,v_apps,snap,vh_path,ca_path
 FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
 WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE;

 v_total := coalesce(pg_catalog.cardinality(ts),0);
 v_coverage_start := CASE WHEN v_total>0 THEN ts[v_total] ELSE NULL END;
 n_pages := least((v_total+39)/40,10000);

 IF n_pages>0 THEN
  b_pages := pg_catalog.array_fill(0,ARRAY[n_pages]);
  b_hi := pg_catalog.array_fill(v_coverage_start,ARRAY[n_pages]);
  b_lo := pg_catalog.array_fill(v_coverage_start,ARRAY[n_pages]);
  b_tie_skip := pg_catalog.array_fill(0,ARRAY[n_pages]);
  prev_m := NULL;
  FOR p IN 1..n_pages LOOP
   pos := (p-1)*40+1;
   lo_pos := least(p*40,v_total);
   hi_ts := ts[pos];
   lo_ts := ts[lo_pos];
   b_pages[p] := p;
   b_hi[p] := hi_ts;
   b_lo[p] := lo_ts;
   IF pos>1 AND ts[pos-1]=hi_ts THEN
    l := 1;
    r := pos;
    WHILE l<r LOOP
     mid := (l+r)/2;
     IF ts[mid]>hi_ts THEN
      l := mid+1;
     ELSE
      r := mid;
     END IF;
    END LOOP;
    b_tie_skip[p] := pos-l;
   ELSE
    b_tie_skip[p] := 0;
   END IF;
   hi_m := pg_catalog.to_char(hi_ts AT TIME ZONE 'UTC','YYYY-MM');
   lo_m := pg_catalog.to_char(lo_ts AT TIME ZONE 'UTC','YYYY-MM');
   IF hi_m IS DISTINCT FROM prev_m THEN
    m_list := pg_catalog.array_append(m_list,hi_m);
    prev_m := hi_m;
   END IF;
   IF NOT pg_catalog.isfinite(hi_ts) OR NOT pg_catalog.isfinite(lo_ts)
    OR hi_m<>lo_m
    OR pg_catalog.date_trunc('month',hi_ts AT TIME ZONE 'UTC')<>pg_catalog.date_trunc('month',lo_ts AT TIME ZONE 'UTC')
   THEN
    FOR k IN (pos+1)..(lo_pos-1) LOOP
     cur_m := pg_catalog.to_char(ts[k] AT TIME ZONE 'UTC','YYYY-MM');
     IF cur_m IS DISTINCT FROM prev_m THEN
      m_list := pg_catalog.array_append(m_list,cur_m);
      prev_m := cur_m;
     END IF;
    END LOOP;
    IF lo_m IS DISTINCT FROM prev_m THEN
     m_list := pg_catalog.array_append(m_list,lo_m);
     prev_m := lo_m;
    END IF;
   END IF;
  END LOOP;
  IF v_total>400000 THEN
   FOR k IN 400001..v_total LOOP
    cur_m := pg_catalog.to_char(ts[k] AT TIME ZONE 'UTC','YYYY-MM');
    IF cur_m IS DISTINCT FROM prev_m THEN
     m_list := pg_catalog.array_append(m_list,cur_m);
     prev_m := cur_m;
    END IF;
   END LOOP;
  END IF;
 ELSE
  b_pages := '{}'::integer[];
  b_hi := '{}'::timestamptz[];
  b_lo := '{}'::timestamptz[];
  b_tie_skip := '{}'::integer[];
 END IF;

 SELECT coalesce(pg_catalog.jsonb_agg(m ORDER BY m DESC),'[]'::jsonb)
 INTO v_months
 FROM (SELECT DISTINCT m FROM pg_catalog.unnest(m_list) AS u(m)) q;

 INSERT INTO catalog_internal.catalog_release_history_meta
 VALUES (1,snap,v_total,v_apps,v_months,v_coverage_start,vh_path,ca_path)
 ON CONFLICT(id) DO UPDATE SET built_snap=excluded.built_snap,total=excluded.total,
  apps=excluded.apps,months=excluded.months,coverage_start=excluded.coverage_start,
  version_history_filepath=excluded.version_history_filepath,curated_apps_filepath=excluded.curated_apps_filepath;
 DELETE FROM catalog_internal.catalog_release_history_page_bounds WHERE page_number IS NOT NULL;
 INSERT INTO catalog_internal.catalog_release_history_page_bounds(page_number,hi,lo,tie_skip)
 SELECT p_num,hi,lo,tie_skip FROM ROWS FROM (
  pg_catalog.unnest(b_pages),
  pg_catalog.unnest(b_hi),
  pg_catalog.unnest(b_lo),
  pg_catalog.unnest(b_tie_skip)
 ) AS u(p_num,hi,lo,tie_skip);
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
