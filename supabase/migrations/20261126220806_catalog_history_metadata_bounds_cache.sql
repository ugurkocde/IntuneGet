SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
ALTER FUNCTION public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text) COST 100;
ALTER FUNCTION public.get_catalog_release_history_global_rows(integer) COST 100;
-- Reusable metadata and rank boundaries with exact live invoker fallback.
CREATE SCHEMA catalog_internal;
REVOKE ALL ON SCHEMA catalog_internal FROM PUBLIC;
GRANT USAGE ON SCHEMA catalog_internal TO anon, authenticated, service_role;
CREATE TABLE catalog_internal.catalog_release_history_meta (
 id integer PRIMARY KEY CHECK(id=1), built_snap pg_snapshot NOT NULL,
 total integer NOT NULL, apps bigint NOT NULL, months jsonb NOT NULL,
 coverage_start timestamptz, version_history_filepath text NOT NULL,
 curated_apps_filepath text NOT NULL
);
CREATE TABLE catalog_internal.catalog_release_history_page_bounds (
 page_number integer PRIMARY KEY, hi timestamptz NOT NULL,
 lo timestamptz NOT NULL, tie_skip integer NOT NULL
);
CREATE TABLE catalog_internal.catalog_release_history_invalidation(xid xid8 PRIMARY KEY);

CREATE FUNCTION catalog_internal.invoker_has_unrestricted_history_visibility()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT NOT pg_catalog.row_security_active('public.version_history'::regclass)
 AND NOT pg_catalog.row_security_active('public.curated_apps'::regclass)
 AND pg_catalog.has_column_privilege(current_user,'public.version_history','id','SELECT')
 AND pg_catalog.has_column_privilege(current_user,'public.version_history','winget_id','SELECT')
 AND pg_catalog.has_column_privilege(current_user,'public.version_history','version','SELECT')
 AND pg_catalog.has_column_privilege(current_user,'public.version_history','release_date','SELECT')
 AND pg_catalog.has_column_privilege(current_user,'public.version_history','created_at','SELECT')
 AND pg_catalog.has_column_privilege(current_user,'public.curated_apps','id','SELECT')
 AND pg_catalog.has_column_privilege(current_user,'public.curated_apps','winget_id','SELECT')
 AND pg_catalog.has_column_privilege(current_user,'public.curated_apps','name','SELECT')
 AND pg_catalog.has_column_privilege(current_user,'public.curated_apps','publisher','SELECT')
 AND pg_catalog.has_column_privilege(current_user,'public.curated_apps','is_locale_variant','SELECT')
 -- Include both source relations in planning/locking even on direct cache reads.
 AND NOT EXISTS(SELECT 1 FROM public.version_history WHERE false)
 AND NOT EXISTS(SELECT 1 FROM public.curated_apps WHERE false)
$$;
REVOKE ALL ON FUNCTION catalog_internal.invoker_has_unrestricted_history_visibility() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog_internal.invoker_has_unrestricted_history_visibility() TO anon,authenticated,service_role;

ALTER TABLE catalog_internal.catalog_release_history_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_internal.catalog_release_history_meta FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_internal.catalog_release_history_page_bounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_internal.catalog_release_history_page_bounds FORCE ROW LEVEL SECURITY;
ALTER TABLE catalog_internal.catalog_release_history_invalidation ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_internal.catalog_release_history_invalidation FORCE ROW LEVEL SECURITY;
CREATE POLICY read_meta ON catalog_internal.catalog_release_history_meta FOR SELECT
 USING(catalog_internal.invoker_has_unrestricted_history_visibility());
CREATE POLICY read_bounds ON catalog_internal.catalog_release_history_page_bounds FOR SELECT
 USING(catalog_internal.invoker_has_unrestricted_history_visibility());
CREATE POLICY read_invalidation ON catalog_internal.catalog_release_history_invalidation FOR SELECT
 -- ON CONFLICT needs SELECT visibility of the inserted tuple under FORCE RLS.
 -- A restricted writer may see only the marker for its own transaction.
 USING(catalog_internal.invoker_has_unrestricted_history_visibility()
  OR xid=pg_catalog.pg_current_xact_id_if_assigned());
CREATE POLICY write_meta ON catalog_internal.catalog_release_history_meta FOR ALL
 USING(catalog_internal.invoker_has_unrestricted_history_visibility())
 WITH CHECK(catalog_internal.invoker_has_unrestricted_history_visibility());
CREATE POLICY write_bounds ON catalog_internal.catalog_release_history_page_bounds FOR ALL
 USING(catalog_internal.invoker_has_unrestricted_history_visibility())
 WITH CHECK(catalog_internal.invoker_has_unrestricted_history_visibility());
CREATE POLICY insert_invalidation ON catalog_internal.catalog_release_history_invalidation FOR INSERT WITH CHECK(true);
CREATE POLICY delete_invalidation ON catalog_internal.catalog_release_history_invalidation FOR DELETE USING(true);
REVOKE ALL ON ALL TABLES IN SCHEMA catalog_internal FROM PUBLIC,anon,authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA catalog_internal TO anon,authenticated,service_role;
GRANT INSERT,UPDATE,DELETE ON catalog_internal.catalog_release_history_meta,
 catalog_internal.catalog_release_history_page_bounds TO service_role;
GRANT INSERT,DELETE ON catalog_internal.catalog_release_history_invalidation TO service_role;

CREATE FUNCTION catalog_internal.mark_history_cache_dirty() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM inserted_history_rows) THEN RETURN NULL; END IF;
 END IF;
 INSERT INTO catalog_internal.catalog_release_history_invalidation(xid)
 VALUES(pg_catalog.pg_current_xact_id()) ON CONFLICT(xid) DO NOTHING;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION catalog_internal.mark_history_cache_dirty() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER history_cache_insert AFTER INSERT ON public.version_history
 REFERENCING NEW TABLE AS inserted_history_rows
 FOR EACH STATEMENT EXECUTE FUNCTION catalog_internal.mark_history_cache_dirty();
CREATE TRIGGER history_cache_structure AFTER DELETE OR TRUNCATE
 ON public.version_history FOR EACH STATEMENT EXECUTE FUNCTION catalog_internal.mark_history_cache_dirty();
CREATE TRIGGER history_cache_identity AFTER UPDATE ON public.version_history FOR EACH ROW
 WHEN(OLD.id IS DISTINCT FROM NEW.id OR OLD.winget_id IS DISTINCT FROM NEW.winget_id OR OLD.created_at IS DISTINCT FROM NEW.created_at)
 EXECUTE FUNCTION catalog_internal.mark_history_cache_dirty();
CREATE TRIGGER history_cache_insert AFTER INSERT ON public.curated_apps
 REFERENCING NEW TABLE AS inserted_history_rows
 FOR EACH STATEMENT EXECUTE FUNCTION catalog_internal.mark_history_cache_dirty();
CREATE TRIGGER history_cache_structure AFTER DELETE OR TRUNCATE
 ON public.curated_apps FOR EACH STATEMENT EXECUTE FUNCTION catalog_internal.mark_history_cache_dirty();
CREATE TRIGGER history_cache_identity AFTER UPDATE ON public.curated_apps FOR EACH ROW
 WHEN(OLD.winget_id IS DISTINCT FROM NEW.winget_id OR (OLD.is_locale_variant IS NOT TRUE) IS DISTINCT FROM (NEW.is_locale_variant IS NOT TRUE))
 EXECUTE FUNCTION catalog_internal.mark_history_cache_dirty();

CREATE FUNCTION catalog_internal.history_cache_is_usable() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT catalog_internal.invoker_has_unrestricted_history_visibility()
 AND EXISTS(SELECT 1 FROM catalog_internal.catalog_release_history_meta m WHERE m.id=1
  AND m.version_history_filepath=pg_catalog.pg_relation_filepath('public.version_history'::regclass)
  AND m.curated_apps_filepath=pg_catalog.pg_relation_filepath('public.curated_apps'::regclass)
  AND NOT EXISTS(SELECT 1 FROM catalog_internal.catalog_release_history_invalidation i
   WHERE NOT pg_catalog.pg_visible_in_snapshot(i.xid,m.built_snap)))
$$;
REVOKE ALL ON FUNCTION catalog_internal.history_cache_is_usable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog_internal.history_cache_is_usable() TO anon,authenticated,service_role;

CREATE FUNCTION public.refresh_catalog_release_history_cache() RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $$
DECLARE ts timestamptz[]; app_ids integer[]; snap pg_snapshot; vh_path text; ca_path text;
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
 WITH agg AS MATERIALIZED (
  SELECT array_agg(v.created_at) AS times,array_agg(c.id) AS ids
  FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
  WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
 ), ord AS MATERIALIZED (
  SELECT array_agg(t ORDER BY t) AS times FROM (SELECT unnest(a.times) AS t FROM agg a) s
 )
 SELECT o.times,a.ids,pg_catalog.pg_current_snapshot(),
  pg_catalog.pg_relation_filepath('public.version_history'::regclass),
  pg_catalog.pg_relation_filepath('public.curated_apps'::regclass)
 INTO ts,app_ids,snap,vh_path,ca_path FROM agg a CROSS JOIN ord o;
 INSERT INTO catalog_internal.catalog_release_history_meta
 SELECT 1,snap,coalesce(cardinality(ts),0),
  (SELECT count(DISTINCT x) FROM unnest(app_ids) x),
  coalesce((SELECT jsonb_agg(m ORDER BY m DESC) FROM (
   SELECT to_char(t AT TIME ZONE 'UTC','YYYY-MM') AS m FROM unnest(ts) t GROUP BY m
  ) q),'[]'::jsonb),ts[1],vh_path,ca_path
 ON CONFLICT(id) DO UPDATE SET built_snap=excluded.built_snap,total=excluded.total,
  apps=excluded.apps,months=excluded.months,coverage_start=excluded.coverage_start,
  version_history_filepath=excluded.version_history_filepath,curated_apps_filepath=excluded.curated_apps_filepath;
 DELETE FROM catalog_internal.catalog_release_history_page_bounds;
 INSERT INTO catalog_internal.catalog_release_history_page_bounds
 SELECT page,ts[cardinality(ts)-skipped],ts[greatest(cardinality(ts)-skipped-39,1)],
  skipped-(cardinality(ts)-width_bucket(ts[cardinality(ts)-skipped],ts))
 FROM (SELECT page,(page-1)*40 AS skipped FROM generate_series(1,least((coalesce(cardinality(ts),0)+39)/40,10000)) page) q;
 DELETE FROM catalog_internal.catalog_release_history_invalidation i WHERE pg_catalog.pg_visible_in_snapshot(i.xid,snap);
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_catalog_release_history_cache() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_catalog_release_history_cache() TO service_role;
DO $guard$
DECLARE original record; changed record;
BEGIN
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict,md5(prosrc) AS body INTO original
 FROM pg_proc WHERE oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure;
 IF original.body NOT IN ('140284c9ef91b45bfd09845c99bb1651','839974702e6611589ab67450c681f7fe') OR original.proowner<>current_user::regrole::oid
  OR original.prosecdef OR original.provolatile<>'s' OR original.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 THEN RAISE EXCEPTION 'Unexpected catalog history predecessor'; END IF;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION public.get_catalog_release_history_v2(
  search_text text DEFAULT '', month_filter text DEFAULT '', kind_filter text DEFAULT 'all', page_number integer DEFAULT 1,
  app_filter text DEFAULT '', date_from date DEFAULT NULL, date_to date DEFAULT NULL, architecture_filter text DEFAULT ''
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
SELECT CASE WHEN coalesce(app_filter,'')='' AND coalesce(search_text,'')='' AND coalesce(month_filter,'')=''
 AND date_from IS NULL AND date_to IS NULL AND coalesce(architecture_filter,'')='' AND kind_filter='all' AND catalog_internal.history_cache_is_usable() THEN (
SELECT CASE WHEN greatest(1,least(coalesce(page_number,1),10000))<=100 THEN (
WITH visible AS NOT MATERIALIZED (
 SELECT v.winget_id,c.name,c.publisher,v.version,v.release_date,v.created_at AS detected_at,v.id
 FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
 WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
), page_rows AS MATERIALIZED (
 SELECT * FROM visible ORDER BY detected_at DESC,id DESC
 LIMIT 40 OFFSET ((greatest(1,least(coalesce(page_number,1),10000))-1)*40)
), complete_page AS (
  SELECT p.*, prev_row.version AS previous_version
  FROM page_rows p
  LEFT JOIN LATERAL (
    SELECT prev_v.version FROM public.version_history prev_v
    WHERE prev_v.winget_id = p.winget_id AND prev_v.created_at IS NOT NULL
      AND (prev_v.created_at, prev_v.id) < (p.detected_at, p.id)
    ORDER BY prev_v.created_at DESC, prev_v.id DESC LIMIT 1
  ) prev_row ON true
), global_metadata AS MATERIALIZED (
 SELECT total,apps,months,coverage_start FROM catalog_internal.catalog_release_history_meta WHERE id=1
)
SELECT jsonb_build_object(
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(p)-'id' ORDER BY detected_at DESC,id DESC) FROM complete_page p),'[]'::jsonb),
 'total',m.total,'apps',m.apps,'firstTracked',m.apps,'months',m.months,'coverageStart',m.coverage_start,
 'sync',(SELECT jsonb_build_object('status',last_run_status,'completedAt',last_run_completed_at,'lastSuccessfulAt',last_successful_sync_at) FROM public.curated_sync_status WHERE id='sync-manifests')
) FROM global_metadata m
) ELSE (
WITH global_metadata AS MATERIALIZED (
 SELECT total,apps,months,coverage_start FROM catalog_internal.catalog_release_history_meta WHERE id=1
), bounds AS MATERIALIZED (
 SELECT hi,lo,tie_skip FROM catalog_internal.catalog_release_history_page_bounds
 WHERE page_number=greatest(1,least(coalesce($4,1),10000))
), page_ids AS MATERIALIZED (
 SELECT w.id FROM bounds b CROSS JOIN LATERAL (
  SELECT v.id,row_number() OVER (ORDER BY v.created_at DESC,v.id DESC) AS rn
  FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
  WHERE v.created_at BETWEEN b.lo AND b.hi AND c.is_locale_variant IS NOT TRUE
 ) w WHERE w.rn>b.tie_skip AND w.rn<=b.tie_skip+40
), page_rows AS MATERIALIZED (
 SELECT v.winget_id,c.name,c.publisher,v.version,v.release_date,v.created_at AS detected_at,v.id
 FROM page_ids s JOIN public.version_history v ON v.id=s.id
 JOIN public.curated_apps c ON c.winget_id=v.winget_id
 WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
), complete_page AS (
 SELECT p.*,prev_row.version AS previous_version FROM page_rows p
 LEFT JOIN LATERAL (
  SELECT prev_v.version FROM public.version_history prev_v
  WHERE prev_v.winget_id=p.winget_id AND prev_v.created_at IS NOT NULL
   AND (prev_v.created_at,prev_v.id)<(p.detected_at,p.id)
  ORDER BY prev_v.created_at DESC,prev_v.id DESC LIMIT 1
 ) prev_row ON true
)
SELECT jsonb_build_object(
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(p)-'id' ORDER BY detected_at DESC,id DESC) FROM complete_page p),'[]'::jsonb),
 'total',m.total,'apps',m.apps,'firstTracked',m.apps,'months',m.months,'coverageStart',m.coverage_start,
 'sync',(SELECT jsonb_build_object('status',last_run_status,'completedAt',last_run_completed_at,'lastSuccessfulAt',last_successful_sync_at) FROM public.curated_sync_status WHERE id='sync-manifests')
) FROM global_metadata m
) END
) ELSE (
SELECT CASE WHEN coalesce(app_filter,'')='' AND coalesce(search_text,'')='' AND coalesce(month_filter,'')=''
 AND date_from IS NULL AND date_to IS NULL AND coalesce(architecture_filter,'')='' AND kind_filter='all' AND greatest(1,least(coalesce(page_number,1),10000))<=100 THEN (
WITH visible AS NOT MATERIALIZED (
 SELECT v.winget_id,c.name,c.publisher,v.version,v.release_date,v.created_at AS detected_at,v.id
 FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
 WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
), page_rows AS MATERIALIZED (
 SELECT * FROM visible ORDER BY detected_at DESC,id DESC
 LIMIT 40 OFFSET ((greatest(1,least(coalesce(page_number,1),10000))-1)*40)
), complete_page AS (
  SELECT p.*, prev_row.version AS previous_version
  FROM page_rows p
  LEFT JOIN LATERAL (
    SELECT prev_v.version FROM public.version_history prev_v
    WHERE prev_v.winget_id = p.winget_id AND prev_v.created_at IS NOT NULL
      AND (prev_v.created_at, prev_v.id) < (p.detected_at, p.id)
    ORDER BY prev_v.created_at DESC, prev_v.id DESC LIMIT 1
  ) prev_row ON true
), global_metadata AS MATERIALIZED (
 SELECT count(*) AS total,count(DISTINCT winget_id) AS apps,min(detected_at) AS coverage_start,
 coalesce(jsonb_agg(DISTINCT to_char(detected_at AT TIME ZONE 'UTC','YYYY-MM') ORDER BY to_char(detected_at AT TIME ZONE 'UTC','YYYY-MM') DESC),'[]'::jsonb) AS months
 FROM visible
)
SELECT jsonb_build_object(
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(p)-'id' ORDER BY detected_at DESC,id DESC) FROM complete_page p),'[]'::jsonb),
 'total',m.total,'apps',m.apps,'firstTracked',m.apps,'months',m.months,'coverageStart',m.coverage_start,
 'sync',(SELECT jsonb_build_object('status',last_run_status,'completedAt',last_run_completed_at,'lastSuccessfulAt',last_successful_sync_at) FROM public.curated_sync_status WHERE id='sync-manifests')
) FROM global_metadata m
) WHEN coalesce(app_filter,'')='' AND coalesce(search_text,'')='' AND coalesce(month_filter,'')=''
 AND date_from IS NULL AND date_to IS NULL AND coalesce(architecture_filter,'')='' AND kind_filter='all' THEN (
WITH agg AS MATERIALIZED (
 -- Plain aggregates avoid a history tuplestore. Sort only by-value datums.
 SELECT array_agg(v.created_at) AS ts,array_agg(c.id) AS app_ids
 FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
 WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
), ord AS MATERIALIZED (
 SELECT array_agg(t ORDER BY t) AS ts FROM (SELECT unnest(a.ts) AS t FROM agg a) s
), global_metadata AS MATERIALIZED (
 SELECT coalesce(cardinality(o.ts),0) AS total,o.ts[1] AS coverage_start,
 (greatest(1,least(coalesce(page_number,1),10000))-1)*40 AS skipped,
 (SELECT count(DISTINCT i) FROM (SELECT unnest(a.app_ids) AS i FROM agg a) s) AS apps,
 coalesce((SELECT jsonb_agg(m ORDER BY m DESC) FROM (
  SELECT to_char(t AT TIME ZONE 'UTC','YYYY-MM') AS m
  FROM (SELECT unnest(o.ts) AS t) u GROUP BY m
 ) months),'[]'::jsonb) AS months
 FROM ord o
), bounds AS MATERIALIZED (
 -- width_bucket counts timestamps <= hi, locating the first boundary tie.
 SELECT o.ts[m.total-m.skipped] AS hi,o.ts[greatest(m.total-m.skipped-39,1)] AS lo,
 m.skipped-(m.total-width_bucket(o.ts[m.total-m.skipped],o.ts)) AS tie_skip
 FROM global_metadata m CROSS JOIN ord o WHERE m.total>m.skipped
), page_ids AS MATERIALIZED (
 SELECT w.id FROM bounds b CROSS JOIN LATERAL (
  SELECT v.id,row_number() OVER (ORDER BY v.created_at DESC,v.id DESC) AS rn
  FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
  WHERE v.created_at BETWEEN b.lo AND b.hi AND c.is_locale_variant IS NOT TRUE
 ) w WHERE w.rn>b.tie_skip AND w.rn<=b.tie_skip+40
), page_rows AS MATERIALIZED (
 SELECT v.winget_id,c.name,c.publisher,v.version,v.release_date,v.created_at AS detected_at,v.id
 FROM page_ids s JOIN public.version_history v ON v.id=s.id
 JOIN public.curated_apps c ON c.winget_id=v.winget_id
 WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
), complete_page AS (
 SELECT p.*,prev_row.version AS previous_version FROM page_rows p
 LEFT JOIN LATERAL (
  SELECT prev_v.version FROM public.version_history prev_v
  WHERE prev_v.winget_id=p.winget_id AND prev_v.created_at IS NOT NULL
   AND (prev_v.created_at,prev_v.id)<(p.detected_at,p.id)
  ORDER BY prev_v.created_at DESC,prev_v.id DESC LIMIT 1
 ) prev_row ON true
)
SELECT jsonb_build_object(
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(p)-'id' ORDER BY detected_at DESC,id DESC) FROM complete_page p),'[]'::jsonb),
 'total',m.total,'apps',m.apps,'firstTracked',m.apps,'months',m.months,'coverageStart',m.coverage_start,
 'sync',(SELECT jsonb_build_object('status',last_run_status,'completedAt',last_run_completed_at,'lastSuccessfulAt',last_successful_sync_at) FROM public.curated_sync_status WHERE id='sync-manifests')
) FROM global_metadata m
) WHEN coalesce(app_filter, '') = '' THEN (

WITH scoped_apps AS MATERIALIZED (
  SELECT c.winget_id, c.name, c.publisher, first_row.id AS first_id
  FROM public.curated_apps c
  CROSS JOIN LATERAL (
    SELECT first_v.id FROM public.version_history first_v
    WHERE first_v.winget_id = c.winget_id AND first_v.created_at IS NOT NULL
    ORDER BY first_v.created_at, first_v.id LIMIT 1
  ) first_row
  WHERE (coalesce(app_filter, '') = '' OR lower(c.winget_id) = lower(left(app_filter, 120)))
    AND c.is_locale_variant IS NOT TRUE
), history AS MATERIALIZED (
  SELECT v.winget_id, c.name, c.publisher, v.version, v.release_date,
    v.created_at AS detected_at, v.id, v.id = c.first_id AS is_first
  FROM public.version_history v JOIN scoped_apps c USING (winget_id)
  WHERE v.created_at IS NOT NULL
), filtered AS MATERIALIZED (
  SELECT * FROM history
  WHERE (coalesce(month_filter, '') = '' OR to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM') = month_filter)
    AND (date_from IS NULL OR detected_at >= date_from::timestamp AT TIME ZONE 'UTC')
    AND (date_to IS NULL OR detected_at < (date_to + 1)::timestamp AT TIME ZONE 'UTC')
    AND (coalesce(architecture_filter, '') = '' OR EXISTS (
      SELECT 1 FROM public.version_history av, jsonb_array_elements(CASE WHEN jsonb_typeof(av.installers) = 'array' THEN av.installers ELSE '[]'::jsonb END) ai
      WHERE av.winget_id = history.winget_id AND av.version = history.version AND lower(ai->>'Architecture') = architecture_filter
    ))
    AND (coalesce(search_text, '') = '' OR position(lower(left(search_text, 120)) in lower(name || ' ' || coalesce(publisher, '') || ' ' || winget_id)) > 0)
    AND (kind_filter = 'all' OR (kind_filter = 'first' AND is_first) OR (kind_filter = 'updated' AND NOT is_first))
), page_rows AS MATERIALIZED (
  SELECT winget_id, name, publisher, version, release_date, detected_at, id
  FROM filtered ORDER BY detected_at DESC, id DESC
  LIMIT 40 OFFSET ((greatest(1, least(coalesce(page_number, 1), 10000)) - 1) * 40)
), complete_page AS (
  SELECT p.*, prev_row.version AS previous_version
  FROM page_rows p
  LEFT JOIN LATERAL (
    SELECT prev_v.version FROM public.version_history prev_v
    WHERE prev_v.winget_id = p.winget_id AND prev_v.created_at IS NOT NULL
      AND (prev_v.created_at, prev_v.id) < (p.detected_at, p.id)
    ORDER BY prev_v.created_at DESC, prev_v.id DESC LIMIT 1
  ) prev_row ON true
)
SELECT jsonb_build_object(
  'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) - 'id' ORDER BY detected_at DESC, id DESC) FROM complete_page p), '[]'::jsonb),
  'total', (SELECT count(*) FROM filtered),
  'apps', (SELECT count(DISTINCT winget_id) FROM filtered),
  'firstTracked', (SELECT count(*) FROM filtered WHERE is_first),
  'months', coalesce((SELECT jsonb_agg(m ORDER BY m DESC) FROM (SELECT DISTINCT to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM') AS m FROM history) months), '[]'::jsonb),
  'coverageStart', (SELECT min(detected_at) FROM history),
  'sync', (SELECT jsonb_build_object('status', last_run_status, 'completedAt', last_run_completed_at, 'lastSuccessfulAt', last_successful_sync_at) FROM public.curated_sync_status WHERE id = 'sync-manifests')
)
) ELSE (

WITH scoped_apps AS MATERIALIZED (
  SELECT c.winget_id, c.name, c.publisher, first_row.id AS first_id
  FROM public.curated_apps c
  CROSS JOIN LATERAL (
    SELECT first_v.id FROM public.version_history first_v
    WHERE first_v.winget_id = c.winget_id AND first_v.created_at IS NOT NULL
    ORDER BY first_v.created_at, first_v.id LIMIT 1
  ) first_row
  WHERE lower(c.winget_id) = lower(left(app_filter, 120))
    AND c.is_locale_variant IS NOT TRUE
), history AS MATERIALIZED (
  SELECT v.winget_id, c.name, c.publisher, v.version, v.release_date,
    v.created_at AS detected_at, v.id, v.id = c.first_id AS is_first
  FROM public.version_history v JOIN scoped_apps c USING (winget_id)
  WHERE v.created_at IS NOT NULL
), filtered AS MATERIALIZED (
  SELECT * FROM history
  WHERE (coalesce(month_filter, '') = '' OR to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM') = month_filter)
    AND (date_from IS NULL OR detected_at >= date_from::timestamp AT TIME ZONE 'UTC')
    AND (date_to IS NULL OR detected_at < (date_to + 1)::timestamp AT TIME ZONE 'UTC')
    AND (coalesce(architecture_filter, '') = '' OR EXISTS (
      SELECT 1 FROM public.version_history av, jsonb_array_elements(CASE WHEN jsonb_typeof(av.installers) = 'array' THEN av.installers ELSE '[]'::jsonb END) ai
      WHERE av.winget_id = history.winget_id AND av.version = history.version AND lower(ai->>'Architecture') = architecture_filter
    ))
    AND (coalesce(search_text, '') = '' OR position(lower(left(search_text, 120)) in lower(name || ' ' || coalesce(publisher, '') || ' ' || winget_id)) > 0)
    AND (kind_filter = 'all' OR (kind_filter = 'first' AND is_first) OR (kind_filter = 'updated' AND NOT is_first))
), page_rows AS MATERIALIZED (
  SELECT winget_id, name, publisher, version, release_date, detected_at, id
  FROM filtered ORDER BY detected_at DESC, id DESC
  LIMIT 40 OFFSET ((greatest(1, least(coalesce(page_number, 1), 10000)) - 1) * 40)
), complete_page AS (
  SELECT p.*, prev_row.version AS previous_version
  FROM page_rows p
  LEFT JOIN LATERAL (
    SELECT prev_v.version FROM public.version_history prev_v
    WHERE prev_v.winget_id = p.winget_id AND prev_v.created_at IS NOT NULL
      AND (prev_v.created_at, prev_v.id) < (p.detected_at, p.id)
    ORDER BY prev_v.created_at DESC, prev_v.id DESC LIMIT 1
  ) prev_row ON true
)
SELECT jsonb_build_object(
  'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) - 'id' ORDER BY detected_at DESC, id DESC) FROM complete_page p), '[]'::jsonb),
  'total', (SELECT count(*) FROM filtered),
  'apps', (SELECT count(DISTINCT winget_id) FROM filtered),
  'firstTracked', (SELECT count(*) FROM filtered WHERE is_first),
  'months', coalesce((SELECT jsonb_agg(m ORDER BY m DESC) FROM (SELECT DISTINCT to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM') AS m FROM history) months), '[]'::jsonb),
  'coverageStart', (SELECT min(detected_at) FROM history),
  'sync', (SELECT jsonb_build_object('status', last_run_status, 'completedAt', last_run_completed_at, 'lastSuccessfulAt', last_successful_sync_at) FROM public.curated_sync_status WHERE id = 'sync-manifests')
)
) END
) END
$$;$definition$;
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict INTO changed
 FROM pg_proc WHERE oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure;
 IF ROW(changed.proowner,changed.proacl,changed.proconfig,changed.prosecdef,changed.provolatile,changed.prolang,changed.proisstrict) IS DISTINCT FROM ROW(original.proowner,original.proacl,original.proconfig,original.prosecdef,original.provolatile,original.prolang,original.proisstrict)
 THEN RAISE EXCEPTION 'Catalog history security contract changed'; END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
DO $guard$
DECLARE original record; changed record;
BEGIN
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict,md5(prosrc) AS body INTO original
 FROM pg_proc WHERE oid='public.get_catalog_release_history_global_rows(integer)'::regprocedure;
 IF original.body NOT IN ('d5bbdf22c9cb272b737fab91882d4d91','3057edd36a50792f47eab226703cebbd') OR original.proowner<>current_user::regrole::oid
  OR original.prosecdef OR original.provolatile<>'s' OR original.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
 THEN RAISE EXCEPTION 'Unexpected catalog history predecessor'; END IF;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION public.get_catalog_release_history_global_rows(page_number integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
 IF greatest(1,least(coalesce(page_number,1),10000))<=100 THEN
 EXECUTE $query$
WITH visible AS NOT MATERIALIZED (
 SELECT v.winget_id,c.name,c.publisher,v.version,v.release_date,v.created_at AS detected_at,v.id
 FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
 WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
), page_rows AS MATERIALIZED (
 SELECT * FROM visible ORDER BY detected_at DESC,id DESC
 LIMIT 40 OFFSET ((greatest(1,least(coalesce($1,1),10000))-1)*40)
), complete_page AS (
  SELECT p.*, prev_row.version AS previous_version
  FROM page_rows p
  LEFT JOIN LATERAL (
    SELECT prev_v.version FROM public.version_history prev_v
    WHERE prev_v.winget_id = p.winget_id AND prev_v.created_at IS NOT NULL
      AND (prev_v.created_at, prev_v.id) < (p.detected_at, p.id)
    ORDER BY prev_v.created_at DESC, prev_v.id DESC LIMIT 1
  ) prev_row ON true

)
SELECT coalesce((SELECT jsonb_agg(to_jsonb(p) - 'id' ORDER BY detected_at DESC, id DESC)
  FROM complete_page p), '[]'::jsonb)
  $query$ INTO result USING page_number;
 ELSE
  EXECUTE $query$
SELECT CASE WHEN catalog_internal.history_cache_is_usable() THEN (
WITH global_metadata AS MATERIALIZED (
 SELECT total,apps,months,coverage_start FROM catalog_internal.catalog_release_history_meta WHERE id=1
), bounds AS MATERIALIZED (
 SELECT hi,lo,tie_skip FROM catalog_internal.catalog_release_history_page_bounds
 WHERE page_number=greatest(1,least(coalesce($1,1),10000))
), page_ids AS MATERIALIZED (
 SELECT w.id FROM bounds b CROSS JOIN LATERAL (
  SELECT v.id,row_number() OVER (ORDER BY v.created_at DESC,v.id DESC) AS rn
  FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
  WHERE v.created_at BETWEEN b.lo AND b.hi AND c.is_locale_variant IS NOT TRUE
 ) w WHERE w.rn>b.tie_skip AND w.rn<=b.tie_skip+40
), page_rows AS MATERIALIZED (
 SELECT v.winget_id,c.name,c.publisher,v.version,v.release_date,v.created_at AS detected_at,v.id
 FROM page_ids s JOIN public.version_history v ON v.id=s.id
 JOIN public.curated_apps c ON c.winget_id=v.winget_id
 WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
), complete_page AS (
 SELECT p.*,prev_row.version AS previous_version FROM page_rows p
 LEFT JOIN LATERAL (
  SELECT prev_v.version FROM public.version_history prev_v
  WHERE prev_v.winget_id=p.winget_id AND prev_v.created_at IS NOT NULL
   AND (prev_v.created_at,prev_v.id)<(p.detected_at,p.id)
  ORDER BY prev_v.created_at DESC,prev_v.id DESC LIMIT 1
 ) prev_row ON true
)
SELECT coalesce((SELECT jsonb_agg(to_jsonb(p)-'id' ORDER BY detected_at DESC,id DESC) FROM complete_page p),'[]'::jsonb)
) ELSE (
WITH agg AS MATERIALIZED (
 -- Match the V2 timestamp bounds without its metadata-only app array.
 SELECT array_agg(v.created_at) AS ts
 FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
 WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
), ord AS MATERIALIZED (
 SELECT array_agg(t ORDER BY t) AS ts FROM (SELECT unnest(a.ts) AS t FROM agg a) s
), global_metadata AS MATERIALIZED (
 SELECT coalesce(cardinality(o.ts),0) AS total,o.ts[1] AS coverage_start,
 (greatest(1,least(coalesce($1,1),10000))-1)*40 AS skipped
 FROM ord o
), bounds AS MATERIALIZED (
 SELECT o.ts[m.total-m.skipped] AS hi,o.ts[greatest(m.total-m.skipped-39,1)] AS lo,
 m.skipped-(m.total-width_bucket(o.ts[m.total-m.skipped],o.ts)) AS tie_skip
 FROM global_metadata m CROSS JOIN ord o WHERE m.total>m.skipped
), page_ids AS MATERIALIZED (
 SELECT w.id FROM bounds b CROSS JOIN LATERAL (
  SELECT v.id,row_number() OVER (ORDER BY v.created_at DESC,v.id DESC) AS rn
  FROM public.version_history v JOIN public.curated_apps c ON c.winget_id=v.winget_id
  WHERE v.created_at BETWEEN b.lo AND b.hi AND c.is_locale_variant IS NOT TRUE
 ) w WHERE w.rn>b.tie_skip AND w.rn<=b.tie_skip+40
), page_rows AS MATERIALIZED (
 SELECT v.winget_id,c.name,c.publisher,v.version,v.release_date,v.created_at AS detected_at,v.id
 FROM page_ids s JOIN public.version_history v ON v.id=s.id
 JOIN public.curated_apps c ON c.winget_id=v.winget_id
 WHERE v.created_at IS NOT NULL AND c.is_locale_variant IS NOT TRUE
), complete_page AS (
 SELECT p.*,prev_row.version AS previous_version FROM page_rows p
 LEFT JOIN LATERAL (
  SELECT prev_v.version FROM public.version_history prev_v
  WHERE prev_v.winget_id=p.winget_id AND prev_v.created_at IS NOT NULL
   AND (prev_v.created_at,prev_v.id)<(p.detected_at,p.id)
  ORDER BY prev_v.created_at DESC,prev_v.id DESC LIMIT 1
 ) prev_row ON true
)
SELECT coalesce((SELECT jsonb_agg(to_jsonb(p) - 'id' ORDER BY detected_at DESC, id DESC)
  FROM complete_page p), '[]'::jsonb)
) END
  $query$ INTO result USING page_number;
 END IF;
  RETURN result;
END;
$function$;$definition$;
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict INTO changed
 FROM pg_proc WHERE oid='public.get_catalog_release_history_global_rows(integer)'::regprocedure;
 IF ROW(changed.proowner,changed.proacl,changed.proconfig,changed.prosecdef,changed.provolatile,changed.prolang,changed.proisstrict) IS DISTINCT FROM ROW(original.proowner,original.proacl,original.proconfig,original.prosecdef,original.provolatile,original.prolang,original.proisstrict)
 THEN RAISE EXCEPTION 'Catalog history security contract changed'; END IF;
END;
$guard$;
