SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';
-- Count the existing recent updated rows without constructing a history page.
CREATE OR REPLACE FUNCTION public.get_catalog_recent_update_count(date_from date)
RETURNS bigint LANGUAGE sql STABLE STRICT SECURITY INVOKER SET search_path = '' AS $$
SELECT count(*)
FROM public.version_history v
JOIN public.curated_apps c ON c.winget_id = v.winget_id AND c.is_locale_variant IS NOT TRUE
WHERE v.created_at >= date_from::timestamp AT TIME ZONE 'UTC'
  AND EXISTS (
    SELECT 1 FROM public.version_history p
    WHERE p.winget_id = v.winget_id AND p.created_at IS NOT NULL
      AND (p.created_at, p.id) < (v.created_at, v.id)
  );
$$;
REVOKE ALL ON FUNCTION public.get_catalog_recent_update_count(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_catalog_recent_update_count(date) TO service_role;
NOTIFY pgrst, 'reload schema';
