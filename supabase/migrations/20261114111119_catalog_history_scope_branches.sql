-- Keep app reads scoped and scan narrow history keys once for global metadata.
CREATE OR REPLACE FUNCTION public.get_catalog_release_history_v2(
  search_text text DEFAULT '', month_filter text DEFAULT '', kind_filter text DEFAULT 'all', page_number integer DEFAULT 1,
  app_filter text DEFAULT '', date_from date DEFAULT NULL, date_to date DEFAULT NULL, architecture_filter text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  scoped_app_ids text[];
  history_result jsonb;
BEGIN
  IF coalesce(app_filter, '') <> '' THEN
    SELECT array_agg(c.winget_id) INTO scoped_app_ids
    FROM public.curated_apps c
    WHERE lower(c.winget_id) = lower(left(app_filter, 120))
      AND c.is_locale_variant IS NOT TRUE;

WITH scoped_apps AS MATERIALIZED (
  SELECT c.winget_id, c.name, c.publisher, first_row.id AS first_id
  FROM unnest(scoped_app_ids) AS a(winget_id)
  JOIN public.curated_apps c ON c.winget_id = a.winget_id
  CROSS JOIN LATERAL (
    SELECT first_v.id FROM public.version_history first_v
    WHERE first_v.winget_id = a.winget_id AND first_v.created_at IS NOT NULL
    ORDER BY first_v.created_at, first_v.id LIMIT 1
  ) first_row
), history AS MATERIALIZED (
  SELECT v.winget_id, c.name, c.publisher, v.version, v.release_date,
    v.created_at AS detected_at, v.id, v.id = c.first_id AS is_first
  FROM scoped_apps c
  CROSS JOIN LATERAL (
    SELECT v0.winget_id, v0.version, v0.release_date, v0.created_at, v0.id
    FROM public.version_history v0
    WHERE v0.winget_id = c.winget_id AND v0.created_at IS NOT NULL
    OFFSET 0
  ) v
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
) INTO history_result;
  ELSE
WITH firsts AS MATERIALIZED (
  SELECT DISTINCT ON (v.winget_id) v.winget_id, v.id
  FROM public.version_history v
  WHERE v.created_at IS NOT NULL
  ORDER BY v.winget_id, v.created_at, v.id
), scoped_apps AS MATERIALIZED (
  SELECT c.winget_id, c.name, c.publisher, f.id AS first_id
  FROM public.curated_apps c JOIN firsts f USING (winget_id)
  WHERE c.is_locale_variant IS NOT TRUE
), history AS MATERIALIZED (
  SELECT v.winget_id, v.created_at AS detected_at, v.id, v.id = c.first_id AS is_first
  FROM public.version_history v JOIN scoped_apps c USING (winget_id)
  WHERE v.created_at IS NOT NULL
), filtered AS MATERIALIZED (
  SELECT * FROM history
  WHERE (coalesce(month_filter, '') = '' OR to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM') = month_filter)
    AND (date_from IS NULL OR detected_at >= date_from::timestamp AT TIME ZONE 'UTC')
    AND (date_to IS NULL OR detected_at < (date_to + 1)::timestamp AT TIME ZONE 'UTC')
    AND (coalesce(architecture_filter, '') = '' OR EXISTS (
      SELECT 1 FROM public.version_history hv JOIN public.version_history av ON av.winget_id = hv.winget_id AND av.version = hv.version, jsonb_array_elements(CASE WHEN jsonb_typeof(av.installers) = 'array' THEN av.installers ELSE '[]'::jsonb END) ai
      WHERE hv.id = history.id AND lower(ai->>'Architecture') = architecture_filter
    ))
    AND (coalesce(search_text, '') = '' OR winget_id IN (SELECT winget_id FROM scoped_apps WHERE position(lower(left(search_text, 120)) in lower(name || ' ' || coalesce(publisher, '') || ' ' || winget_id)) > 0))
    AND (kind_filter = 'all' OR (kind_filter = 'first' AND is_first) OR (kind_filter = 'updated' AND NOT is_first))
), page_rows AS MATERIALIZED (
  SELECT winget_id, detected_at, id
  FROM filtered ORDER BY detected_at DESC, id DESC
  LIMIT 40 OFFSET ((greatest(1, least(coalesce(page_number, 1), 10000)) - 1) * 40)
), complete_page AS (
  SELECT p.winget_id, c.name, c.publisher, v.version, v.release_date, p.detected_at, p.id, prev_row.version AS previous_version
  FROM page_rows p
  JOIN public.version_history v ON v.id = p.id
  JOIN scoped_apps c ON c.winget_id = p.winget_id
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
) INTO history_result;
  END IF;
  RETURN history_result;
END;
$$;
