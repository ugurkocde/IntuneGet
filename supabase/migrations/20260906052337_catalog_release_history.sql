-- Catalog observation timestamps survive metadata refreshes. No historical
-- publisher dates or last-success timestamps are invented during migration.
ALTER TABLE public.curated_sync_status ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_version_history_observed ON public.version_history(created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.preserve_version_first_observed()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_version_first_observed() FROM PUBLIC;
CREATE TRIGGER preserve_version_first_observed BEFORE UPDATE ON public.version_history
FOR EACH ROW EXECUTE FUNCTION public.preserve_version_first_observed();

CREATE OR REPLACE FUNCTION public.get_catalog_release_history(
  search_text text DEFAULT '', month_filter text DEFAULT '', kind_filter text DEFAULT 'all', page_number integer DEFAULT 1
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
WITH history AS MATERIALIZED (
  SELECT v.winget_id, c.name, c.publisher, v.version, v.release_date,
    v.created_at AS detected_at, v.id,
    lag(v.version) OVER (PARTITION BY v.winget_id ORDER BY v.created_at, v.id) AS previous_version
  FROM public.version_history v JOIN public.curated_apps c USING (winget_id)
  WHERE c.is_locale_variant IS NOT TRUE AND v.created_at IS NOT NULL
), filtered AS MATERIALIZED (
  SELECT * FROM history
  WHERE (coalesce(month_filter, '') = '' OR to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM') = month_filter)
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
REVOKE ALL ON FUNCTION public.get_catalog_release_history(text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_catalog_release_history(text, text, text, integer) TO anon, authenticated, service_role;
