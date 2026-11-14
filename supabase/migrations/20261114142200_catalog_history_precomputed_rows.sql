-- Keep full history derivation out of request and cache revalidation queries.
CREATE TABLE public.catalog_release_history_rows (
  id integer PRIMARY KEY,
  winget_id text NOT NULL,
  version text NOT NULL,
  release_date timestamptz,
  detected_at timestamptz NOT NULL,
  is_first boolean NOT NULL,
  previous_version text,
  architectures text[] NOT NULL
);
CREATE INDEX catalog_history_rows_detected ON public.catalog_release_history_rows (detected_at DESC, id DESC);
CREATE INDEX catalog_history_rows_app_detected ON public.catalog_release_history_rows (winget_id, detected_at DESC, id DESC);
ALTER TABLE public.catalog_release_history_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read catalog history rows" ON public.catalog_release_history_rows FOR SELECT USING (true);
REVOKE ALL ON public.catalog_release_history_rows FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.catalog_release_history_rows TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalog_release_history_rows TO service_role;

CREATE FUNCTION public.refresh_catalog_release_history_rows()
RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE changed bigint;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('catalog_release_history_rows', 0)) THEN
    RETURN -1;
  END IF;
  MERGE INTO public.catalog_release_history_rows t USING (
    SELECT v.id, v.winget_id, v.version, v.release_date, v.created_at AS detected_at,
      row_number() OVER w = 1 AS is_first, lag(v.version) OVER w AS previous_version,
      ARRAY(SELECT DISTINCT lower(ai->>'Architecture')
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.installers) = 'array' THEN v.installers ELSE '[]'::jsonb END) ai
        ORDER BY 1) AS architectures
    FROM public.version_history v WHERE v.created_at IS NOT NULL
    WINDOW w AS (PARTITION BY v.winget_id ORDER BY v.created_at, v.id)
  ) s ON t.id = s.id
  WHEN MATCHED AND (t.winget_id,t.version,t.release_date,t.detected_at,t.is_first,t.previous_version,t.architectures)
    IS DISTINCT FROM (s.winget_id,s.version,s.release_date,s.detected_at,s.is_first,s.previous_version,s.architectures)
    THEN UPDATE SET winget_id=s.winget_id, version=s.version, release_date=s.release_date,
      detected_at=s.detected_at, is_first=s.is_first, previous_version=s.previous_version, architectures=s.architectures
  WHEN NOT MATCHED BY TARGET THEN INSERT (id,winget_id,version,release_date,detected_at,is_first,previous_version,architectures)
    VALUES (s.id,s.winget_id,s.version,s.release_date,s.detected_at,s.is_first,s.previous_version,s.architectures)
  WHEN NOT MATCHED BY SOURCE THEN DELETE;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_catalog_release_history_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_catalog_release_history_rows() TO service_role;
SELECT public.refresh_catalog_release_history_rows();

CREATE OR REPLACE FUNCTION public.get_catalog_release_history_v2(
  search_text text DEFAULT '', month_filter text DEFAULT '', kind_filter text DEFAULT 'all', page_number integer DEFAULT 1,
  app_filter text DEFAULT '', date_from date DEFAULT NULL, date_to date DEFAULT NULL, architecture_filter text DEFAULT ''
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH history AS MATERIALIZED (
  SELECT r.winget_id, c.name, c.publisher, r.version, r.release_date,
    r.detected_at, r.id, r.is_first, r.previous_version, r.architectures
  FROM public.catalog_release_history_rows r JOIN public.curated_apps c USING (winget_id)
  WHERE (coalesce(app_filter, '') = '' OR lower(c.winget_id) = lower(left(app_filter, 120)))
    AND c.is_locale_variant IS NOT TRUE
), filtered AS MATERIALIZED (
  SELECT * FROM history
  WHERE (coalesce(month_filter, '') = '' OR to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM') = month_filter)
    AND (date_from IS NULL OR detected_at >= date_from::timestamp AT TIME ZONE 'UTC')
    AND (date_to IS NULL OR detected_at < (date_to + 1)::timestamp AT TIME ZONE 'UTC')
    AND (coalesce(architecture_filter, '') = '' OR architecture_filter = ANY(architectures))
    AND (coalesce(search_text, '') = '' OR position(lower(left(search_text, 120)) in lower(name || ' ' || coalesce(publisher, '') || ' ' || winget_id)) > 0)
    AND (kind_filter = 'all' OR (kind_filter = 'first' AND is_first) OR (kind_filter = 'updated' AND NOT is_first))
), page_rows AS MATERIALIZED (
  SELECT winget_id, name, publisher, version, release_date, detected_at, id, previous_version
  FROM filtered ORDER BY detected_at DESC, id DESC
  LIMIT 40 OFFSET ((greatest(1, least(coalesce(page_number, 1), 10000)) - 1) * 40)
)
SELECT jsonb_build_object(
  'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) - 'id' ORDER BY detected_at DESC, id DESC) FROM page_rows p), '[]'::jsonb),
  'total', (SELECT count(*) FROM filtered),
  'apps', (SELECT count(DISTINCT winget_id) FROM filtered),
  'firstTracked', (SELECT count(*) FROM filtered WHERE is_first),
  'months', coalesce((SELECT jsonb_agg(m ORDER BY m DESC) FROM (SELECT DISTINCT to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM') AS m FROM history) months), '[]'::jsonb),
  'coverageStart', (SELECT min(detected_at) FROM history),
  'sync', (SELECT jsonb_build_object('status', last_run_status, 'completedAt', last_run_completed_at, 'lastSuccessfulAt', last_successful_sync_at) FROM public.curated_sync_status WHERE id = 'sync-manifests')
);
$$;
