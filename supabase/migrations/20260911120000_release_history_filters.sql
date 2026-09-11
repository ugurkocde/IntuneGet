-- Additive API: existing clients retain the original function. Apply before deploying the website.
CREATE OR REPLACE FUNCTION public.get_catalog_release_history_v2(
  search_text text DEFAULT '', month_filter text DEFAULT '', kind_filter text DEFAULT 'all', page_number integer DEFAULT 1,
  app_filter text DEFAULT '', date_from date DEFAULT NULL, date_to date DEFAULT NULL, architecture_filter text DEFAULT ''
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH history AS MATERIALIZED (
  SELECT v.winget_id, c.name, c.publisher, v.version, v.release_date,
    v.created_at AS detected_at, v.id,
    lag(v.version) OVER (PARTITION BY v.winget_id ORDER BY v.created_at, v.id) AS previous_version
  FROM public.version_history v JOIN public.curated_apps c USING (winget_id)
  WHERE (coalesce(app_filter, '') = '' OR lower(v.winget_id) = lower(left(app_filter, 120))) AND c.is_locale_variant IS NOT TRUE AND v.created_at IS NOT NULL
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
    AND (kind_filter = 'all' OR (kind_filter = 'first' AND previous_version IS NULL) OR (kind_filter = 'updated' AND previous_version IS NOT NULL))
), page_rows AS (
  SELECT * FROM filtered ORDER BY detected_at DESC, id DESC LIMIT 40 OFFSET ((greatest(1, least(coalesce(page_number, 1), 10000)) - 1) * 40)
)
SELECT jsonb_build_object(
  'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) - 'id' ORDER BY detected_at DESC, id DESC) FROM page_rows p), '[]'::jsonb),
  'total', (SELECT count(*) FROM filtered),
  'apps', (SELECT count(DISTINCT winget_id) FROM filtered),
  'firstTracked', (SELECT count(*) FROM filtered WHERE previous_version IS NULL),
  'months', coalesce((SELECT jsonb_agg(m ORDER BY m DESC) FROM (SELECT DISTINCT to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM') AS m FROM history) months), '[]'::jsonb),
  'coverageStart', (SELECT min(detected_at) FROM history),
  'sync', (SELECT jsonb_build_object('status', last_run_status, 'completedAt', last_run_completed_at, 'lastSuccessfulAt', last_successful_sync_at) FROM public.curated_sync_status WHERE id = 'sync-manifests')
);
$$;
REVOKE ALL ON FUNCTION public.get_catalog_release_history_v2(text, text, text, integer, text, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_release_history_v2(text, text, text, integer, text, date, date, text) TO anon, authenticated, service_role;
