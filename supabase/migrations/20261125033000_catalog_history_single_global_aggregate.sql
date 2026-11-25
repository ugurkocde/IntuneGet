SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';
DO $migration$
DECLARE original record; replacement record;
BEGIN
  if to_regprocedure('public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)') is null then raise exception 'Unexpected catalog history source'; end if;
  select proowner,proacl,proconfig,prosecdef,provolatile,prolang,md5(prosrc) as body_md5 from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure into original;
  if original.body_md5 <> 'ad242d7a91bc9b113e21c6e83df690c7'
    or original.proconfig is distinct from ARRAY['search_path=""']::text[]
    or original.prosecdef or original.provolatile <> 's'
    or original.prolang <> (select oid from pg_language where lanname='sql')
    or original.proowner <> current_user::regrole::oid then
    raise exception 'Unexpected catalog history source';
  end if;
  EXECUTE $definition$
CREATE OR REPLACE FUNCTION public.get_catalog_release_history_v2(
  search_text text DEFAULT '', month_filter text DEFAULT '', kind_filter text DEFAULT 'all', page_number integer DEFAULT 1,
  app_filter text DEFAULT '', date_from date DEFAULT NULL, date_to date DEFAULT NULL, architecture_filter text DEFAULT ''
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
SELECT CASE WHEN coalesce(app_filter,'')='' AND coalesce(search_text,'')='' AND coalesce(month_filter,'')=''
 AND date_from IS NULL AND date_to IS NULL AND coalesce(architecture_filter,'')='' AND kind_filter='all' THEN (
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
  select proowner,proacl,proconfig,prosecdef,provolatile,prolang,md5(prosrc) as body_md5 from pg_proc where oid='public.get_catalog_release_history_v2(text,text,text,integer,text,date,date,text)'::regprocedure into replacement;
  if replacement.body_md5 <> 'f2fe5dcfbf679e917e909d41d6ff0a09'
    or replacement.proowner is distinct from original.proowner
    or replacement.proacl is distinct from original.proacl
    or replacement.proconfig is distinct from original.proconfig
    or replacement.prosecdef is distinct from original.prosecdef
    or replacement.provolatile is distinct from original.provolatile
    or replacement.prolang is distinct from original.prolang then
    raise exception 'Catalog history contract changed';
  end if;
END
$migration$;
NOTIFY pgrst, 'reload schema';
