SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';

-- Plan the page query with its bound offset, without rebuilding global totals.
-- The unchanged v2 function remains the cold, filtered and public fallback.
-- Rollback: revert the source caller before dropping this additive function.
CREATE FUNCTION public.get_catalog_release_history_global_rows(page_number integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE result jsonb;
BEGIN
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
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_catalog_release_history_global_rows(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalog_release_history_global_rows(integer) TO service_role;
NOTIFY pgrst, 'reload schema';
