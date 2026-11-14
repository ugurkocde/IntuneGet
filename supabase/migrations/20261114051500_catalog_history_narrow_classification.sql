CREATE OR REPLACE FUNCTION public.get_catalog_release_history_v2(
  search_text text DEFAULT '', month_filter text DEFAULT '', kind_filter text DEFAULT 'all', page_number integer DEFAULT 1,
  app_filter text DEFAULT '', date_from date DEFAULT NULL, date_to date DEFAULT NULL, architecture_filter text DEFAULT ''
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH scoped_apps AS MATERIALIZED (
  SELECT c.winget_id, c.name, c.publisher
  FROM public.curated_apps c
  WHERE (coalesce(app_filter, '') = '' OR lower(c.winget_id) = lower(left(app_filter, 120)))
    AND c.is_locale_variant IS NOT TRUE
), curated_ids AS MATERIALIZED (
  -- Parameter-free scope for the unfiltered branch: accurate generic estimate and no per-row index probe.
  SELECT c.winget_id FROM public.curated_apps c WHERE c.is_locale_variant IS NOT TRUE
), history AS NOT MATERIALIZED (
  SELECT * FROM (
  SELECT v.winget_id, v.created_at AS detected_at, v.id
  FROM public.version_history v JOIN curated_ids c ON c.winget_id = v.winget_id
  WHERE coalesce(app_filter, '') = '' AND v.created_at IS NOT NULL
  UNION ALL
  SELECT v.winget_id, v.created_at AS detected_at, v.id
  FROM public.version_history v JOIN scoped_apps c ON c.winget_id = v.winget_id
  WHERE coalesce(app_filter, '') <> '' AND v.created_at IS NOT NULL
  ) scoped_history OFFSET 0 -- keeps parameter filters out of the join estimate
), first_rows AS MATERIALIZED (
  -- One hashed pass: the per-app minimum of (created_at, id) is exactly the old first row.
  SELECT winget_id, min(detected_at) AS first_time, min(ARRAY[extract(epoch FROM detected_at), id]) AS first_key
  FROM history GROUP BY winget_id
), first_ids AS MATERIALIZED (
  SELECT first_key[2]::integer AS id FROM first_rows
), filtered AS NOT MATERIALIZED (
  -- Subplans stay in WHERE so every aggregate over this CTE remains hashable in generic plans.
  SELECT h.winget_id, h.detected_at, h.id
  FROM history h
  WHERE (coalesce(month_filter, '') = '' OR to_char(h.detected_at AT TIME ZONE 'UTC', 'YYYY-MM') = month_filter)
    AND (date_from IS NULL OR h.detected_at >= date_from::timestamp AT TIME ZONE 'UTC')
    AND (date_to IS NULL OR h.detected_at < (date_to + 1)::timestamp AT TIME ZONE 'UTC')
    AND (coalesce(architecture_filter, '') = '' OR EXISTS (
      SELECT 1 FROM public.version_history av,
        jsonb_array_elements(CASE WHEN jsonb_typeof(av.installers) = 'array' THEN av.installers ELSE '[]'::jsonb END) ai
      WHERE av.id = h.id AND lower(ai->>'Architecture') = architecture_filter
    ))
    AND (coalesce(search_text, '') = '' OR h.winget_id IN (
      SELECT a.winget_id FROM scoped_apps a
      WHERE position(lower(left(search_text, 120)) in lower(a.name || ' ' || coalesce(a.publisher, '') || ' ' || a.winget_id)) > 0
    ))
    AND (kind_filter = 'all' OR (kind_filter = 'first' AND h.id IN (SELECT id FROM first_ids))
      OR (kind_filter = 'updated' AND h.id NOT IN (SELECT id FROM first_ids)))
), totals AS MATERIALIZED (
  SELECT coalesce(sum(n), 0) AS total, count(*) AS apps FROM (SELECT winget_id, count(*) AS n FROM filtered GROUP BY winget_id) per_app
), page_rows AS MATERIALIZED (
  SELECT detected_at, id FROM filtered
  ORDER BY detected_at DESC, id DESC
  LIMIT 40 OFFSET ((greatest(1, least(coalesce(page_number, 1), 10000)) - 1) * 40)
), complete_page AS (
  SELECT v.winget_id, a.name, a.publisher, v.version, v.release_date,
    p.detected_at, p.id, prev_row.version AS previous_version
  FROM page_rows p
  JOIN public.version_history v ON v.id = p.id
  JOIN scoped_apps a ON a.winget_id = v.winget_id
  LEFT JOIN LATERAL (
    SELECT prev_v.version FROM public.version_history prev_v
    WHERE prev_v.winget_id = v.winget_id AND prev_v.created_at IS NOT NULL
      AND (prev_v.created_at, prev_v.id) < (p.detected_at, p.id)
    ORDER BY prev_v.created_at DESC, prev_v.id DESC LIMIT 1
  ) prev_row ON true
)
SELECT jsonb_build_object(
  'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) - 'id' ORDER BY detected_at DESC, id DESC) FROM complete_page p), '[]'::jsonb),
  'total', (SELECT total FROM totals),
  'apps', (SELECT apps FROM totals),
  'firstTracked', CASE kind_filter WHEN 'first' THEN (SELECT total FROM totals) WHEN 'all' THEN (SELECT count(*) FILTER (WHERE id IN (SELECT id FROM first_ids)) FROM filtered) ELSE 0 END,
  'months', coalesce((SELECT jsonb_agg(m ORDER BY m DESC) FROM (SELECT DISTINCT to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM') AS m FROM history) months), '[]'::jsonb),
  'coverageStart', (SELECT min(first_time) FROM first_rows),
  'sync', (SELECT jsonb_build_object('status', last_run_status, 'completedAt', last_run_completed_at, 'lastSuccessfulAt', last_successful_sync_at) FROM public.curated_sync_status WHERE id = 'sync-manifests')
);
$$;
