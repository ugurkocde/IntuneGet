SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';

DO $migration$
DECLARE original record; replacement record;
BEGIN
 IF to_regprocedure('public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)') IS NULL THEN RAISE EXCEPTION 'Unexpected catalog history source'; END IF;
 ALTER FUNCTION public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text) COST 100;
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict,md5(prosrc) AS body_md5
 INTO original FROM pg_proc WHERE oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure;
 IF original.body_md5 NOT IN ('f2fe5dcfbf679e917e909d41d6ff0a09','3e82bf31d631c89505336f8d038d9c29')
  OR original.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR original.proisstrict OR original.prosecdef OR original.provolatile<>'s'
  OR original.prolang<>(SELECT oid FROM pg_language WHERE lanname='sql')
  OR original.proowner<>current_user::regrole::oid THEN RAISE EXCEPTION 'Unexpected catalog history source'; END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.get_catalog_release_history_v2(
  search_text text DEFAULT '', month_filter text DEFAULT '', kind_filter text DEFAULT 'all', page_number integer DEFAULT 1,
  app_filter text DEFAULT '', date_from date DEFAULT NULL, date_to date DEFAULT NULL, architecture_filter text DEFAULT ''
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
SELECT CASE WHEN coalesce(app_filter,'')='' AND coalesce(search_text,'')='' AND coalesce(month_filter,'')=''
 AND date_from IS NULL AND date_to IS NULL AND coalesce(architecture_filter,'')='' AND kind_filter='all' THEN (
WITH hist AS MATERIALIZED (
 -- Keep an uncovered column in this materialized projection: an index-only
 -- walk can otherwise revisit most heap pages before selecting a deep page.
 SELECT v.id,v.winget_id,v.created_at,v.version FROM public.version_history v
 WHERE v.created_at IS NOT NULL
), visible AS NOT MATERIALIZED (
 SELECT h.id,h.winget_id,h.created_at AS detected_at FROM hist h
 JOIN public.curated_apps c ON c.winget_id=h.winget_id
 WHERE c.is_locale_variant IS NOT TRUE
), global_metadata AS MATERIALIZED (
 SELECT count(*) AS total,count(DISTINCT winget_id) AS apps,min(detected_at) AS coverage_start,coalesce(jsonb_agg(DISTINCT to_char(detected_at AT TIME ZONE 'UTC','YYYY-MM') ORDER BY to_char(detected_at AT TIME ZONE 'UTC','YYYY-MM') DESC),'[]'::jsonb) AS months,array_agg(id ORDER BY detected_at DESC,id DESC) AS ordered_ids FROM visible
), page_ids AS MATERIALIZED (
 SELECT s.id FROM global_metadata m CROSS JOIN LATERAL unnest(m.ordered_ids[
   (greatest(1,least(coalesce(page_number,1),10000))-1)*40+1:
    greatest(1,least(coalesce(page_number,1),10000))*40]) AS s(id)
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
) END;
$$;
$definition$;
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict,md5(prosrc) AS body_md5
 INTO replacement FROM pg_proc WHERE oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure;
 IF replacement.body_md5 NOT IN ('8866c51cb4e76c6d18b3d197f7d11f1e','13c7edfd916ab0c81d53d73f48a3a7f7')
  OR replacement.proowner IS DISTINCT FROM original.proowner OR replacement.proacl IS DISTINCT FROM original.proacl
  OR replacement.proconfig IS DISTINCT FROM original.proconfig OR replacement.prosecdef IS DISTINCT FROM original.prosecdef
  OR replacement.provolatile IS DISTINCT FROM original.provolatile OR replacement.prolang IS DISTINCT FROM original.prolang
  OR replacement.proisstrict IS DISTINCT FROM original.proisstrict THEN RAISE EXCEPTION 'Catalog history contract changed'; END IF;
END
$migration$;
DO $migration$
DECLARE original record; replacement record;
BEGIN
 IF to_regprocedure('public.get_catalog_release_history_global_rows(integer)') IS NULL THEN RAISE EXCEPTION 'Unexpected catalog history source'; END IF;
 ALTER FUNCTION public.get_catalog_release_history_global_rows(integer) COST 100;
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict,md5(prosrc) AS body_md5
 INTO original FROM pg_proc WHERE oid='public.get_catalog_release_history_global_rows(integer)'::regprocedure;
 IF original.body_md5 NOT IN ('30e257fefc006ac4087e08164791819c','7e0cc5d6e64ce39ad567e63e616ed441')
  OR original.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR original.proisstrict OR original.prosecdef OR original.provolatile<>'s'
  OR original.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  OR original.proowner<>current_user::regrole::oid THEN RAISE EXCEPTION 'Unexpected catalog history source'; END IF;
 EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.get_catalog_release_history_global_rows(page_number integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
  EXECUTE $query$
WITH hist AS MATERIALIZED (
 -- Keep an uncovered column in this materialized projection: an index-only
 -- walk can otherwise revisit most heap pages before selecting a deep page.
 SELECT v.id,v.winget_id,v.created_at,v.version FROM public.version_history v
 WHERE v.created_at IS NOT NULL
), visible AS NOT MATERIALIZED (
 SELECT h.id,h.winget_id,h.created_at AS detected_at FROM hist h
 JOIN public.curated_apps c ON c.winget_id=h.winget_id
 WHERE c.is_locale_variant IS NOT TRUE
), page_lookup AS MATERIALIZED (
 SELECT array_agg(id ORDER BY detected_at DESC,id DESC) AS ordered_ids FROM visible
), page_ids AS MATERIALIZED (
 SELECT s.id FROM page_lookup m CROSS JOIN LATERAL unnest(m.ordered_ids[
   (greatest(1,least(coalesce($1,1),10000))-1)*40+1:
    greatest(1,least(coalesce($1,1),10000))*40]) AS s(id)
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
  $query$ INTO result USING page_number;
  RETURN result;
END;
$function$;

$definition$;
 SELECT proowner,proacl,proconfig,prosecdef,provolatile,prolang,proisstrict,md5(prosrc) AS body_md5
 INTO replacement FROM pg_proc WHERE oid='public.get_catalog_release_history_global_rows(integer)'::regprocedure;
 IF replacement.body_md5 NOT IN ('4c21f3c8e7424d8d7b40695fc8e61eab','4f1d061810253dc993873b7d2bdbaf52')
  OR replacement.proowner IS DISTINCT FROM original.proowner OR replacement.proacl IS DISTINCT FROM original.proacl
  OR replacement.proconfig IS DISTINCT FROM original.proconfig OR replacement.prosecdef IS DISTINCT FROM original.prosecdef
  OR replacement.provolatile IS DISTINCT FROM original.provolatile OR replacement.prolang IS DISTINCT FROM original.prolang
  OR replacement.proisstrict IS DISTINCT FROM original.proisstrict THEN RAISE EXCEPTION 'Catalog history contract changed'; END IF;
END
$migration$;
NOTIFY pgrst, 'reload schema';
